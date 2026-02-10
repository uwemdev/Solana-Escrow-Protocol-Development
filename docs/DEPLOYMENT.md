# Deployment Guide

Complete guide for deploying SolanaGuard Escrow Protocol to Solana devnet or mainnet.

---

## Prerequisites

Before deployment, ensure you have:

- ✅ Rust toolchain installed
- ✅ Solana CLI installed and configured
- ✅ Anchor CLI installed
- ✅ Sufficient SOL for deployment (~2-3 SOL for devnet, more for mainnet)

---

## Environment Setup

### 1. Configure Solana CLI

```bash
# Set cluster to devnet
solana config set --url devnet

# Verify configuration
solana config get
```

Expected output:
```
Config File: /home/user/.config/solana/cli/config.yml
RPC URL: https://api.devnet.solana.com
WebSocket URL: wss://api.devnet.solana.com/ (computed)
Keypair Path: /home/user/.config/solana/id.json
Commitment: confirmed
```

### 2. Create/Load Wallet

```bash
# Create new keypair (if you don't have one)
solana-keygen new -o ~/.config/solana/id.json

# Or recover from mnemonic
solana-keygen recover -o ~/.config/solana/id.json

# Check wallet address
solana address

# Check balance
solana balance
```

### 3. Airdrop SOL (Devnet Only)

```bash
# Request 2 SOL from devnet faucet
solana airdrop 2

# Verify balance
solana balance
```

> **Note**: Mainnet deployment requires purchasing real SOL from an exchange.

---

## Build Process

### 1. Clean Build

```bash
# Navigate to project root
cd solana-guard-escrow

# Clean previous builds
anchor clean

# Build the program
anchor build
```

Expected output:
```
   Compiling solana-guard-escrow v0.1.0
    Finished release [optimized] target(s) in X.XXs
```

### 2. Verify Build Artifacts

```bash
# Check program binary exists
ls -lh target/deploy/solana_guard_escrow.so

# Check program keypair exists
ls -lh target/deploy/solana_guard_escrow-keypair.json
```

---

## Program ID Configuration

### 1. Get Program ID

```bash
solana address -k target/deploy/solana_guard_escrow-keypair.json
```

Example output:
```
9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin
```

### 2. Update Program ID

**File 1**: `programs/solana-guard-escrow/src/lib.rs`

```rust
// Line 8 - Update with your actual program ID
declare_id!("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin");
```

**File 2**: `Anchor.toml`

```toml
[programs.localnet]
solana_guard_escrow = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"

[programs.devnet]
solana_guard_escrow = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"
```

### 3. Rebuild

```bash
# Rebuild with correct program ID
anchor build
```

> **Important**: You must rebuild after updating the program ID!

---

## Deployment

### Deploy to Devnet

```bash
# Deploy using Anchor
anchor deploy --provider.cluster devnet
```

Expected output:
```
Deploying cluster: devnet
Upgrade authority: /home/user/.config/solana/id.json
Deploying program "solana_guard_escrow"...
Program path: /path/to/target/deploy/solana_guard_escrow.so...
Program Id: 9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin

Deploy success
```

### Alternative: Manual Deployment

```bash
# Deploy using Solana CLI directly
solana program deploy \
  target/deploy/solana_guard_escrow.so \
  --url devnet \
  --keypair ~/.config/solana/id.json
```

---

## Verification

### 1. Verify Program Deployment

```bash
solana program show <PROGRAM_ID> --url devnet
```

Expected output:
```
Program Id: 9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin
Owner: BPFLoaderUpgradeab1e11111111111111111111111
ProgramData Address: AbCdEfGhIjKlMnOpQrStUvWxYz123456789
Authority: YourWalletPublicKey...
Last Deployed In Slot: 123456789
Data Length: 98765 bytes (0.09 MB)
Balance: 0.00123456 SOL
```

### 2. Check Program Logs

View recent program logs:
```bash
solana logs <PROGRAM_ID> --url devnet
```

---

## Testing Deployment

### 1. Run Tests Against Deployed Program

```bash
# Update test to use devnet
export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
export ANCHOR_WALLET=~/.config/solana/id.json

# Run tests
anchor test --skip-deploy --provider.cluster devnet
```

### 2. Manual Test with CLI

```bash
# Generate test accounts
cd client && npm run build
node dist/cli.js generate-keypair --output test-buyer.json
node dist/cli.js generate-keypair --output test-seller.json

# Airdrop to buyer
solana airdrop 1 $(solana address -k test-buyer.json) --url devnet

# Create escrow
node dist/cli.js create \
  --buyer test-buyer.json \
  --seller $(solana address -k test-seller.json) \
  --amount 100000000 \
  --timeout 300 \
  --cluster devnet \
  --program-id <YOUR_PROGRAM_ID>
```

---

## Mainnet Deployment

> **WARNING**: Mainnet deployments use real SOL. Thoroughly test on devnet first!

### 1. Configure for Mainnet

```bash
# Switch to mainnet
solana config set --url mainnet-beta

# Verify configuration
solana config get
```

### 2. Fund Wallet

- Transfer SOL from exchange to deployment wallet
- Recommended: 5-10 SOL for deployment + buffer
- Check balance: `solana balance`

### 3. Update Anchor.toml

```toml
[provider]
cluster = "Mainnet"
wallet = "~/.config/solana/id.json"

[programs.mainnet]
solana_guard_escrow = "YourProgramIdHere"
```

### 4. Deploy

```bash
# Deploy to mainnet
anchor deploy --provider.cluster mainnet-beta
```

### 5. Verify on Explorer

Visit: `https://explorer.solana.com/address/<PROGRAM_ID>?cluster=mainnet-beta`

---

## Upgrade Process

### Update Program Code

1. Make changes to program code
2. Rebuild: `anchor build`
3. Deploy upgrade:

```bash
# Upgrade existing program
solana program deploy \
  target/deploy/solana_guard_escrow.so \
  --program-id <PROGRAM_ID> \
  --upgrade-authority ~/.config/solana/id.json \
  --url devnet
```

### Close Upgrade Authority (Immutable)

```bash
# Set program to immutable (cannot be upgraded)
solana program set-upgrade-authority \
  <PROGRAM_ID> \
  --final \
  --url devnet
```

> **WARNING**: This is irreversible! Only do this after thorough testing.

---

## Monitoring

### View Program Logs

```bash
# Real-time logs
solana logs <PROGRAM_ID> --url devnet

# Filter for escrow events
solana logs <PROGRAM_ID> --url devnet | grep "Escrow"
```

### Monitor Transactions

```bash
# View recent transactions
solana transaction-history <WALLET_ADDRESS> --url devnet
```

### Explorer Links

- **Devnet**: `https://explorer.solana.com/address/<PROGRAM_ID>?cluster=devnet`
- **Mainnet**: `https://explorer.solana.com/address/<PROGRAM_ID>?cluster=mainnet-beta`

---

## Troubleshooting

### Error: "Insufficient funds"

```bash
# Check balance
solana balance

# Request airdrop (devnet only)
solana airdrop 2
```

### Error: "Unable to parse input file"

- Verify program binary exists: `ls target/deploy/*.so`
- Rebuild: `anchor build`

### Error: "Program already deployed"

This is normal. Use `solana program deploy` with `--program-id` to upgrade.

### Error: "Invalid program ID"

- Ensure program ID in code matches keypair
- Rebuild after updating IDs

### Deployment Timeout

```bash
# Increase timeout and retry
solana program deploy target/deploy/solana_guard_escrow.so \
  --url devnet \
  --commitment confirmed \
  --max-sign-attempts 100
```

---

## Security Checklist

Before mainnet deployment:

- [ ] Program audited by security firm
- [ ] All tests passing (100% coverage)
- [ ] Successfully tested on devnet
- [ ] Program ID correctly configured
- [ ] Upgrade authority secured (hardware wallet recommended)
- [ ] Emergency response plan documented
- [ ] Bug bounty program considered
- [ ] Monitoring and alerting configured

---

## Cost Breakdown

### Devnet Deployment

- Deployment: FREE (testnet)
- Rent: ~0.00089 SOL per escrow (refundable)
- Transactions: FREE (testnet)

### Mainnet Deployment

- Initial deployment: ~1-2 SOL (one-time)
- Program rent: ~2-3 SOL (refundable if closed)
- Per-escrow rent: ~0.00089 SOL (refundable on cancel)
- Per-transaction: ~0.00025 SOL

---

## Post-Deployment

### 1. Update Client Configuration

Update client to use deployed program ID:

```typescript
// client/src/index.ts
export const PROGRAM_ID = new PublicKey('YourDeployedProgramID');
```

### 2. Publish Client Package

```bash
cd client
npm version 0.1.0
npm publish
```

### 3. Documentation

- Document program ID in README
- Update examples with real program ID
- Publish explorer link

---

## Support

For deployment issues:

- Check [Solana Discord](https://discord.gg/solana)
- Review [Anchor discussions](https://github.com/coral-xyz/anchor/discussions)
- Consult [Solana docs](https://docs.solana.com)

---

**Last Updated**: 2026-02-10  
**Deployment Version**: 0.1.0
