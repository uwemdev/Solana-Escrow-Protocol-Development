# Architecture Deep Dive

## Program Overview

SolanaGuard Escrow Protocol is a decentralized escrow system built on Solana using the Anchor framework. This document provides a technical deep dive into the architecture.

---

## Core Components

### 1. Program Instructions

#### `initialize_escrow`

**Purpose**: Create a new escrow contract

**Accounts**:
- `escrow` - PDA account to store escrow state (init, payer = buyer)
- `buyer` - Signer and payer of transaction
- `seller` - Destination for funds upon release
- `arbiter` - Optional third party for dispute resolution
- `system_program` - For account creation

**Parameters**:
- `amount: u64` - Lamports to escrow (must be > 0)
- `timeout_period: i64` - Seconds before seller can auto-claim (must be > 0)

**PDA Derivation**:
```rust
seeds = [b"escrow", buyer.key().as_ref(), seller.key().as_ref()]
```

**State Changes**:
- Creates escrow account with state = `Created`
- Records buyer, seller, arbiter, amount, created_at timestamp
- Stores timeout_period and bump seed

---

#### `fund_escrow`

**Purpose**: Transfer SOL from buyer to escrow PDA

**Accounts**:
- `escrow` - Escrow PDA (mut, seeds validation, has_one = buyer)
- `buyer` - Signer (mut, pays SOL)
- `system_program` - For CPI transfer

**Validations**:
- Escrow state must be `Created`
- Caller must be original buyer

**Logic**:
1. Validate state == Created
2. CPI to System Program to transfer `amount` lamports
3. Update state to `Funded`

**Security**:
- Anchor `has_one` constraint ensures only original buyer can fund
- State check prevents double-funding

---

#### `release_to_seller`

**Purpose**: Release escrowed funds to seller

**Accounts**:
- `escrow` - Escrow PDA (mut, seeds validation)
- `seller` - Recipient (mut, receives lamports)
- `caller` - Signer (buyer, arbiter, or seller)

**Authorization Logic**:
```rust
let is_authorized = caller == escrow.buyer
    || escrow.arbiter.map_or(false, |a| caller == a)
    || (caller == escrow.seller && time_elapsed >= escrow.timeout_period);
```

**Three Authorization Paths**:
1. **Buyer** - can always release
2. **Arbiter** - can always release (if designated)
3. **Seller** - can release only after timeout

**Transfer Logic**:
1. Calculate escrow balance minus rent
2. Transfer lamports via direct lamport mutation
3. Update state to `Released`

**Rent Preservation**:
```rust
let rent = Rent::get()?.minimum_balance(escrow.data_len());
let transfer_amount = escrow_balance.saturating_sub(rent);
```

---

#### `refund_to_buyer`

**Purpose**: Return funds to buyer (mutual agreement or arbiter decision)

**Accounts**:
- `escrow` - Escrow PDA (mut)
- `buyer` - Refund recipient (mut)
- `caller` - Signer (seller, arbiter, or buyer)

**Authorization**:
- Seller agreeing to refund
- Arbiter deciding buyer should get refund
- Buyer (mutual agreement scenario)

**Process**:
1. Validate state == Funded
2. Calculate refund amount (balance - rent)
3. Transfer to buyer
4. Update state to `Refunded`

---

#### `cancel_escrow`

**Purpose**: Cancel unfunded escrow and reclaim rent

**Accounts**:
- `escrow` - Escrow PDA (mut, close = buyer)
- `buyer` - Receives rent refund (mut)
- `caller` - Signer (buyer or seller)

**Validations**:
- State must be `Created` (not funded)
- Caller must be buyer or seller

**Effect**:
- Closes escrow account
- Rent lamports returned to buyer
- Account data deleted

---

## State Management

### Escrow Account

```rust
#[account]
pub struct Escrow {
    pub buyer: Pubkey,            // 32 bytes
    pub seller: Pubkey,           // 32 bytes
    pub arbiter: Option<Pubkey>,  // 33 bytes (1 discriminator + 32)
    pub amount: u64,              // 8 bytes
    pub created_at: i64,          // 8 bytes (Unix timestamp)
    pub timeout_period: i64,      // 8 bytes (seconds)
    pub state: EscrowState,       // 1 byte
    pub bump: u8,                 // 1 byte
}
// Total: 123 bytes + 8 byte Anchor discriminator = 131 bytes
```

### Lifecycle States

```rust
pub enum EscrowState {
    Created,   // Initialized, not funded
    Funded,    // SOL transferred to PDA
    Released,  // Funds sent to seller
    Refunded,  // Funds returned to buyer
    Cancelled, // Closed before funding
}
```

### Valid State Transitions

```
Created → Funded      (via fund_escrow)
Created → Cancelled   (via cancel_escrow)

Funded → Released     (via release_to_seller)
Funded → Refunded     (via refund_to_buyer)
```

All other transitions are invalid and will error.

---

## Security Model

### PDA Security

**Derivation**:
```rust
[b"escrow", buyer_pubkey, seller_pubkey] => (pda, bump)
```

**Properties**:
- Unique per buyer-seller pair
- No private key exists (program authority only)
- Only program can sign for PDA
- Deterministic address calculation

**Benefits**:
- Funds cannot be stolen (no private key)
- Program logic enforces all transfers
- Users can verify PDA derivation client-side

### Account Validation

Anchor constraints enforce security:

```rust
#[account(
    mut,
    seeds = [b"escrow", escrow.buyer.as_ref(), escrow.seller.as_ref()],
    bump = escrow.bump,
    has_one = buyer  // Ensures caller matches stored buyer
)]
pub escrow: Account<'info, Escrow>,
```

### Authorization Matrix

| Action | Buyer | Seller | Arbiter | Timeout Required |
|--------|-------|--------|---------|------------------|
| Initialize | ✅ | ❌ | ❌ | ❌ |
| Fund | ✅ | ❌ | ❌ | ❌ |
| Release | ✅ | ✅* | ✅ | *Yes for seller |
| Refund | ✅** | ✅ | ✅ | ❌ |
| Cancel | ✅ | ✅ | ❌ | ❌ |

*Seller can release only after timeout
**Buyer refund requires seller or arbiter cooperation

---

## Error Handling

### Custom Errors

```rust
#[error_code]
pub enum EscrowError {
    #[msg("Escrow is already funded, cannot perform this operation")]
    EscrowAlreadyFunded,
    
    #[msg("Escrow is not funded yet")]
    EscrowNotFunded,
    
    #[msg("You are not authorized to perform this operation")]
    UnauthorizedOperation,
    
    #[msg("Invalid amount specified (must be greater than 0)")]
    InvalidAmount,
    
    #[msg("Timeout period has not been reached yet")]
    TimeoutNotReached,
    
    #[msg("Invalid escrow state for this operation")]
    InvalidState,
    
    #[msg("Invalid timeout period (must be greater than 0)")]
    InvalidTimeout,
}
```

### Error Scenarios

- **Double funding**: State check prevents funding twice
- **Wrong caller**: Authorization logic rejects unauthorized operations
- **Invalid state**: State machine prevents invalid transitions
- **Insufficient funds**: Solana runtime enforces balance checks
- **Account mismatch**: Anchor constraints validate account relationships

---

## Gas Optimization

### Rent Efficiency

Escrow account size: 131 bytes
- Rent-exempt minimum: ~0.00089 SOL (approximately)
- Paid once by buyer on initialization
- Returned to buyer on cancellation

### Transaction Costs

Typical costs on Solana devnet/mainnet:
- Initialize: ~0.00025 SOL
- Fund: ~0.00025 SOL
- Release: ~0.00025 SOL
- Refund: ~0.00025 SOL
- Cancel: ~0.00025 SOL

Total for complete happy path: ~0.00075 SOL (< $0.001 USD)

---

## Integration Patterns

### Client SDK Pattern

```typescript
// 1. Derive PDA
const [escrowPda, bump] = PublicKey.findProgramAddressSync(
  [Buffer.from('escrow'), buyer.toBuffer(), seller.toBuffer()],
  programId
);

// 2. Build transaction
const tx = await program.methods
  .initializeEscrow(amount, timeoutPeriod)
  .accounts({ escrow: escrowPda, buyer, seller, arbiter, systemProgram })
  .rpc();

// 3. Confirm and handle
await connection.confirmTransaction(tx);
```

### Event Monitoring

Programs emit logs via `msg!()` macro:
- "Escrow initialized: X lamports, timeout: Y seconds"
- "Escrow funded with X lamports"
- "Escrow released: X lamports to seller"
- "Escrow refunded: X lamports to buyer"
- "Escrow cancelled"

Monitor via WebSocket or transaction logs.

---

## Scalability Considerations

### Account Space

Each escrow: 131 bytes
- 1 million escrows = 131 MB onchain
- Fully decentralized, no centralized database

### Concurrent Escrows

- Each buyer-seller pair can have 1 active escrow
- Same buyer with multiple sellers = multiple escrows
- No global state, fully parallelizable operations

### Throughput

Solana capabilities:
- 65,000 TPS theoretical
- Escrow operations are independent
- No bottlenecks from global state

---

## Future Enhancements

Potential improvements for production:

1. **Fee Mechanism**: Protocol fee to treasury
2. **Multi-party Escrows**: More than 2 parties
3. **Partial Releases**: Release funds incrementally
4. **NFT Escrow**: Extend to SPL tokens and NFTs
5. **Recurring Escrows**: Templates for repeated transactions
6. **Dispute Evidence**: Store IPFS hashes of dispute evidence
7. **Insurance Fund**: Optional insurance for high-value escrows

---

## Comparison to Alternatives

### vs Traditional Escrow

| Feature | SolanaGuard | Traditional |
|---------|-------------|-------------|
| Cost | ~$0.00025/tx | 1-5% of value |
| Speed | <1 second | 3-7 days |
| Trust | Trustless code | Trusted party |
| Geographic | Global | Restricted |

### vs Ethereum Escrow

| Feature | SolanaGuard | Ethereum |
|---------|-------------|----------|
| Cost | ~$0.00025 | $5-50 |
| Speed | <1 second | ~12 seconds |
| Finality | Immediate | ~15 minutes |
| Language | Rust | Solidity |

---

## References

- [Solana Documentation](https://docs.solana.com)
- [Anchor Book](https://book.anchor-lang.com)
- [Program Derived Addresses](https://docs.solana.com/developing/programming-model/calling-between-programs#program-derived-addresses)
- [Solana Account Model](https://docs.solana.com/developing/programming-model/accounts)

---

**Last Updated**: 2026-02-10  
**Version**: 0.1.0
