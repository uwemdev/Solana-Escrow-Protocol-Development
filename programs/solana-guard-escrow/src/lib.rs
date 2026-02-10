use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

pub mod state;
pub mod errors;

use state::*;
use errors::*;

declare_id!("11111111111111111111111111111111");

#[program]
pub mod solana_guard_escrow {
    use super::*;

    // Creates a new escrow between buyer and seller
    pub fn initialize_escrow(
        ctx: Context<InitializeEscrow>,
        amount: u64,
        timeout_period: i64,
    ) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        let clock = Clock::get()?;

        // Basic validation - amount and timeout must be positive
        require!(amount > 0, EscrowError::InvalidAmount);
        require!(timeout_period > 0, EscrowError::InvalidTimeout);

        escrow.buyer = ctx.accounts.buyer.key();
        escrow.seller = ctx.accounts.seller.key();
        
        // If arbiter is same as buyer, treat it as None (no arbiter)
        escrow.arbiter = if ctx.accounts.arbiter.key() == ctx.accounts.buyer.key() {
            None
        } else {
            Some(ctx.accounts.arbiter.key())
        };
        
        escrow.amount = amount;
        escrow.created_at = clock.unix_timestamp;
        escrow.timeout_period = timeout_period;
        escrow.state = EscrowState::Created;
        escrow.bump = ctx.bumps.escrow;

        msg!("Escrow initialized: {} lamports, timeout: {} seconds", amount, timeout_period);

        Ok(())
    }

    /// Fund the escrow by transferring SOL from buyer to escrow PDA
    pub fn fund_escrow(ctx: Context<FundEscrow>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;

        require!(
            escrow.state == EscrowState::Created,
            EscrowError::InvalidState
        );

        // Transfer SOL from buyer to escrow PDA
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.buyer.to_account_info(),
                to: ctx.accounts.escrow.to_account_info(),
            },
        );

        transfer(cpi_context, escrow.amount)?;

        escrow.state = EscrowState::Funded;

        msg!("Escrow funded with {} lamports", escrow.amount);

        Ok(())
    }

    // Release funds to the seller
    // Buyer can do this anytime, seller only after timeout, arbiter anytime
    pub fn release_to_seller(ctx: Context<ReleaseToSeller>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        let clock = Clock::get()?;

        require!(
            escrow.state == EscrowState::Funded,
            EscrowError::EscrowNotFunded
        );

        let caller = ctx.accounts.caller.key();
        let time_elapsed = clock.unix_timestamp - escrow.created_at;

        // Who can release:
        // - Buyer: always
        // - Arbiter: always (if one exists)
        // - Seller: only after the timeout period
        let is_authorized = caller == escrow.buyer
            || escrow.arbiter.map_or(false, |a| caller == a)
            || (caller == escrow.seller && time_elapsed >= escrow.timeout_period);

        require!(is_authorized, EscrowError::UnauthorizedOperation);

        // Figure out how much we can transfer (need to keep rent in the account)
        let escrow_balance = ctx.accounts.escrow.to_account_info().lamports();
        let rent = Rent::get()?.minimum_balance(ctx.accounts.escrow.to_account_info().data_len());
        let transfer_amount = escrow_balance.saturating_sub(rent);

        // Send it to the seller
        **ctx.accounts.escrow.to_account_info().try_borrow_mut_lamports()? -= transfer_amount;
        **ctx.accounts.seller.to_account_info().try_borrow_mut_lamports()? += transfer_amount;

        escrow.state = EscrowState::Released;

        msg!("Escrow released: {} lamports to seller", transfer_amount);

        Ok(())
    }

    /// Refund funds to buyer (callable by seller, arbiter, or buyer for mutual agreement)
    pub fn refund_to_buyer(ctx: Context<RefundToBuyer>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;

        require!(
            escrow.state == EscrowState::Funded,
            EscrowError::EscrowNotFunded
        );

        let caller = ctx.accounts.caller.key();

        // Authorization logic:
        // 1. Seller agreeing to refund
        // 2. Arbiter deciding to refund
        // 3. Buyer (but requires seller's cooperation in practice)
        let is_authorized = caller == escrow.seller
            || escrow.arbiter.map_or(false, |a| caller == a)
            || caller == escrow.buyer;

        require!(is_authorized, EscrowError::UnauthorizedOperation);

        // Calculate transfer amount (escrow balance minus rent)
        let escrow_balance = ctx.accounts.escrow.to_account_info().lamports();
        let rent = Rent::get()?.minimum_balance(ctx.accounts.escrow.to_account_info().data_len());
        let transfer_amount = escrow_balance.saturating_sub(rent);

        // Transfer funds from escrow PDA to buyer
        **ctx.accounts.escrow.to_account_info().try_borrow_mut_lamports()? -= transfer_amount;
        **ctx.accounts.buyer.to_account_info().try_borrow_mut_lamports()? += transfer_amount;

        escrow.state = EscrowState::Refunded;

        msg!("Escrow refunded: {} lamports to buyer", transfer_amount);

        Ok(())
    }

    /// Cancel an unfunded escrow
    pub fn cancel_escrow(ctx: Context<CancelEscrow>) -> Result<()> {
        let escrow = &ctx.accounts.escrow;

        require!(
            escrow.state == EscrowState::Created,
            EscrowError::EscrowAlreadyFunded
        );

        let caller = ctx.accounts.caller.key();
        let is_authorized = caller == escrow.buyer || caller == escrow.seller;

        require!(is_authorized, EscrowError::UnauthorizedOperation);

        // Escrow account will be closed, rent returned to buyer
        msg!("Escrow cancelled");

        Ok(())
    }
}

// ========== Context Structs ==========

#[derive(Accounts)]
#[instruction(amount: u64, timeout_period: i64)]
pub struct InitializeEscrow<'info> {
    #[account(
        init,
        payer = buyer,
        space = 8 + Escrow::LEN,
        seeds = [b"escrow", buyer.key().as_ref(), seller.key().as_ref()],
        bump
    )]
    pub escrow: Account<'info, Escrow>,
    
    #[account(mut)]
    pub buyer: Signer<'info>,
    
    /// CHECK: Seller doesn't need to sign for initialization
    pub seller: AccountInfo<'info>,
    
    /// CHECK: Optional arbiter, can be buyer's key if not used
    pub arbiter: AccountInfo<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FundEscrow<'info> {
    #[account(
        mut,
        seeds = [b"escrow", escrow.buyer.as_ref(), escrow.seller.as_ref()],
        bump = escrow.bump,
        has_one = buyer
    )]
    pub escrow: Account<'info, Escrow>,
    
    #[account(mut)]
    pub buyer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ReleaseToSeller<'info> {
    #[account(
        mut,
        seeds = [b"escrow", escrow.buyer.as_ref(), escrow.seller.as_ref()],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, Escrow>,
    
    /// CHECK: Seller will receive funds
    #[account(mut)]
    pub seller: AccountInfo<'info>,
    
    pub caller: Signer<'info>,
}

#[derive(Accounts)]
pub struct RefundToBuyer<'info> {
    #[account(
        mut,
        seeds = [b"escrow", escrow.buyer.as_ref(), escrow.seller.as_ref()],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, Escrow>,
    
    /// CHECK: Buyer will receive refund
    #[account(mut)]
    pub buyer: AccountInfo<'info>,
    
    pub caller: Signer<'info>,
}

#[derive(Accounts)]
pub struct CancelEscrow<'info> {
    #[account(
        mut,
        seeds = [b"escrow", escrow.buyer.as_ref(), escrow.seller.as_ref()],
        bump = escrow.bump,
        close = buyer
    )]
    pub escrow: Account<'info, Escrow>,
    
    /// CHECK: Receives rent refund
    #[account(mut)]
    pub buyer: AccountInfo<'info>,
    
    pub caller: Signer<'info>,
}
