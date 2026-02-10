# SolanaGuard Escrow

A simple escrow protocol for Solana. Built this to learn Anchor and explore trustless P2P payments.

## What It Does

Holds SOL in escrow between a buyer and seller. Funds are released when:
- Buyer approves
- Timeout expires (seller can claim after waiting)
- Optional arbiter decides

## Why I Built This

Wanted to understand how escrow works on blockchain. Traditional escrow services charge 1-5% fees and take days. This costs ~$0.00025 per transaction and settles in under a second.

Also, good practice with PDAs and Anchor framework.

## Quick Start

```bash
# Clone and build
git clone <repo-url>
cd solana-guard-escrow
anchor build
anchor test
```

## Using the CLI

```bash
cd client && npm install && npm run build

# Make some test wallets
node dist/cli.js generate-keypair --output buyer.json
node dist/cli.js generate-keypair --output seller.json

# Get devnet SOL
solana airdrop 2 $(solana address -k buyer.json) --url devnet

# Create an escrow (1 SOL, 1 hour timeout)
node dist/cli.js create \
  --buyer buyer.json \
  --seller <SELLER_PUBKEY> \
  --amount 1000000000 \
  --timeout 3600 \
  --cluster devnet

# Check what's happening
node dist/cli.js status --escrow <ESCROW_PDA> --cluster devnet

# Release the funds
node dist/cli.js release --escrow <ESCROW_PDA> --keypair buyer.json --cluster devnet
```

## How It Works

The program has 5 instructions:

1. **initialize_escrow** - Creates the escrow account (PDA)
2. **fund_escrow** - Buyer sends SOL to the escrow
3. **release_to_seller** - Sends funds to seller
4. **refund_to_buyer** - Sends funds back to buyer
5. **cancel_escrow** - Cancels an unfunded escrow

### State Flow

```
Created -> Funded -> Released/Refunded -> Closed
     |         |
     v         v
  Cancelled -> Closed
```

## Architecture Notes

**PDAs for Security**  
Uses program-derived addresses so there's no private key to manage. The program itself controls the escrow account.

**Timeout Logic**  
If buyer ghosts, seller can claim after the timeout period. Prevents funds getting locked forever.

**Optional Arbiter**  
You can add a third party to resolve disputes. Or skip it if you trust the other party.

## SDK Usage

```typescript
import { EscrowClient } from './client/src';

const client = await EscrowClient.create(connection, wallet, programId);

// Create escrow
const { escrowPda } = await client.initializeEscrow({
  buyer: buyerKeypair.publicKey,
  seller: sellerPubkey,
  amount: new BN(1_000_000_000), // 1 SOL
  timeoutPeriod: new BN(3600), // 1 hour
});

await client.fundEscrow(escrowPda, buyerKeypair);
await client.releaseToSeller(escrowPda, buyerKeypair);
```

## Deployment

```bash
anchor build

# Get your program ID
solana address -k target/deploy/solana_guard_escrow-keypair.json

# Update it in lib.rs and Anchor.toml, then rebuild
anchor build

# Deploy to devnet
anchor deploy --provider.cluster devnet
```

See [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) for more details.

## Testing

```bash
anchor test
```

Tests cover:
- Creating and funding escrows
- Different release scenarios (buyer, seller after timeout, arbiter)
- Refunds
- Cancellations
- Edge cases

## Potential Use Cases

- Freelance payments
- NFT sales
- P2P trading
- Anything where you need trustless escrow

## Known Issues

- Only supports SOL (no SPL tokens yet)
- No partial releases
- Arbiter can't be changed after creation
- Basic timeout implementation

Maybe I'll add these later if people actually use this.

## Contributing

Feel free to fork and improve. PRs welcome.

## License

MIT

## Tech Stack

- [Solana](https://solana.com)
- [Anchor Framework](https://anchor-lang.com)
- TypeScript for the client

---

Built while learning Solana development. Probably has bugs. Use at your own risk.
