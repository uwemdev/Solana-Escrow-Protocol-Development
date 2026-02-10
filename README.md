# SolanaGuard Escrow Protocol

A trustless peer-to-peer escrow protocol on Solana.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Solana](https://img.shields.io/badge/Solana-1.18-purple)](https://solana.com)
[![Anchor](https://img.shields.io/badge/Anchor-0.30-blue)](https://anchor-lang.com)

---

## Overview

SolanaGuard enables safe transactions between parties without requiring a trusted intermediary. Funds are held in a program-derived address (PDA) and released based on:
- Buyer approval
- Timeout expiration (seller can claim)
- Arbiter decision (optional)

### Features

- **Trustless**: No central authority controls funds
- **Flexible**: Multiple release conditions
- **Secure**: PDA-based storage, state machine validation
- **Fast**: Sub-second finality on Solana
- **Low cost**: ~$0.00025 per transaction

---

## Installation

### Prerequisites

- Rust 1.75+
- Solana CLI 1.18+
- Anchor 0.30+
- Node.js 18+

### Setup

```bash
# Clone repository
git clone <repository-url>
cd solana-guard-escrow

# Build program
anchor build

# Run tests
anchor test

# Install client dependencies
cd client && npm install
```

---

## Usage

### CLI

```bash
cd client
npm run build

# Generate keypairs
node dist/cli.js generate-keypair --output buyer.json
node dist/cli.js generate-keypair --output seller.json

# Create escrow
node dist/cli.js create \
  --buyer buyer.json \
  --seller <SELLER_PUBKEY> \
  --amount 1000000000 \
  --timeout 3600 \
  --cluster devnet

# Check status
node dist/cli.js status --escrow <ESCROW_PDA> --cluster devnet

# Release to seller
node dist/cli.js release --escrow <ESCROW_PDA> --keypair buyer.json --cluster devnet
```

### TypeScript SDK

```typescript
import { Connection, Keypair } from '@solana/web3.js';
import { Wallet, BN } from '@coral-xyz/anchor';
import { EscrowClient } from './client/src';

const connection = new Connection('https://api.devnet.solana.com');
const wallet = new Wallet(buyerKeypair);
const client = await EscrowClient.create(connection, wallet, programId);

// Create escrow
const { escrowPda } = await client.initializeEscrow({
  buyer: buyerKeypair.publicKey,
  seller: sellerPubkey,
  amount: new BN(1_000_000_000),
  timeoutPeriod: new BN(3600),
});

// Fund escrow
await client.fundEscrow(escrowPda, buyerKeypair);

// Release to seller
await client.releaseToSeller(escrowPda, buyerKeypair);
```

---

## Architecture

### Instructions

1. **initialize_escrow** - Create new escrow with PDA
2. **fund_escrow** - Transfer SOL to escrow
3. **release_to_seller** - Send funds to seller
4. **refund_to_buyer** - Return funds to buyer
5. **cancel_escrow** - Close unfunded escrow

### State Machine

```
Created → Funded → Released
    ↓         ↓         ↓
    ↓         ↓    Refunded
    ↓         ↓         ↓
    → → → Cancelled → [Closed]
```

### Security

- **PDA-based storage**: No private keys for escrow account
- **State validation**: Enforced state transitions
- **Authorization checks**: Role-based access control
- **Rent protection**: Automatic balance preservation

---

## Deployment

### Build

```bash
anchor build
```

### Deploy to Devnet

```bash
# Get program ID
solana address -k target/deploy/solana_guard_escrow-keypair.json

# Update program ID in:
# - programs/solana-guard-escrow/src/lib.rs
# - Anchor.toml

# Rebuild and deploy
anchor build
anchor deploy --provider.cluster devnet
```

See [DEPLOYMENT.md](./docs/DEPLOYMENT.md) for detailed instructions.

---

## Testing

```bash
# Run all tests
anchor test

# Test on devnet
anchor test --skip-deploy --provider.cluster devnet
```

The test suite includes:
- Escrow initialization
- Funding mechanics
- Release authorization paths
- Refund flows
- Cancellation logic
- Edge cases and error handling

---

## Documentation

- **[Architecture](./docs/ARCHITECTURE.md)** - Technical deep dive
- **[Deployment](./docs/DEPLOYMENT.md)** - Step-by-step deployment guide

---

## Use Cases

- Freelance marketplace payments
- P2P trading platforms
- International remittances
- NFT sales with buyer protection
- Milestone-based project payments

---

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

---

## License

MIT License - see [LICENSE](./LICENSE) for details

---

## Acknowledgments

Built with [Solana](https://solana.com), [Anchor](https://anchor-lang.com), and [TypeScript](https://www.typescriptlang.org/)
