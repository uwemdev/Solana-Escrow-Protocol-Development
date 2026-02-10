use anchor_lang::prelude::*;

/// Escrow account structure storing all escrow state
#[account]
pub struct Escrow {
    /// Buyer's public key (creates and funds escrow)
    pub buyer: Pubkey,            // 32 bytes
    
    /// Seller's public key (receives funds upon release)
    pub seller: Pubkey,           // 32 bytes
    
    /// Optional arbiter for dispute resolution
    pub arbiter: Option<Pubkey>,  // 1 + 32 = 33 bytes
    
    /// Amount of lamports to be escrowed
    pub amount: u64,              // 8 bytes
    
    /// Unix timestamp when escrow was created
    pub created_at: i64,          // 8 bytes
    
    /// Timeout period in seconds after which seller can claim
    pub timeout_period: i64,      // 8 bytes
    
    /// Current state of the escrow
    pub state: EscrowState,       // 1 byte
    
    /// Bump seed for PDA derivation
    pub bump: u8,                 // 1 byte
}

impl Escrow {
    /// Calculate space needed for Escrow account
    /// Discriminator (8) + buyer (32) + seller (32) + arbiter (33) 
    /// + amount (8) + created_at (8) + timeout_period (8) + state (1) + bump (1)
    pub const LEN: usize = 32 + 32 + 33 + 8 + 8 + 8 + 1 + 1;
}

/// Escrow lifecycle states
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum EscrowState {
    /// Escrow created but not yet funded
    Created,
    
    /// Escrow funded, awaiting release or refund
    Funded,
    
    /// Funds released to seller
    Released,
    
    /// Funds refunded to buyer
    Refunded,
    
    /// Escrow cancelled (before funding)
    Cancelled,
}
