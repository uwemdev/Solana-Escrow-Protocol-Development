#!/usr/bin/env node

import { Command } from 'commander';
import { Connection, Keypair, PublicKey, clusterApiUrl } from '@solana/web3.js';
import { AnchorProvider, Wallet, BN } from '@coral-xyz/anchor';
import {
    EscrowClient,
    loadKeypairFromFile,
    createAndSaveKeypair,
    PROGRAM_ID,
} from './index';
import * as fs from 'fs';

const program = new Command();

program
    .name('solana-escrow-cli')
    .description('CLI for SolanaGuard Escrow Protocol')
    .version('0.1.0');

// Helper to get connection
function getConnection(cluster: string): Connection {
    let url: string;
    if (cluster === 'devnet') {
        url = clusterApiUrl('devnet');
    } else if (cluster === 'mainnet') {
        url = clusterApiUrl('mainnet-beta');
    } else if (cluster === 'testnet') {
        url = clusterApiUrl('testnet');
    } else {
        url = 'http://localhost:8899';
    }
    return new Connection(url, 'confirmed');
}

// Helper to load or create wallet
async function getWallet(keypath: string): Promise<Wallet> {
    if (!fs.existsSync(keypath)) {
        console.log(`⚠️  Keypair not found at ${keypath}`);
        console.log(`Creating new keypair...`);
        const keypair = createAndSaveKeypair(keypath);
        return new Wallet(keypair);
    }
    const keypair = loadKeypairFromFile(keypath);
    return new Wallet(keypair);
}

// Create escrow command
program
    .command('create')
    .description('Initialize a new escrow')
    .requiredOption('-b, --buyer <path>', 'Path to buyer keypair')
    .requiredOption('-s, --seller <pubkey>', 'Seller public key')
    .option('-a, --arbiter <pubkey>', 'Optional arbiter public key')
    .requiredOption('-m, --amount <lamports>', 'Amount in lamports')
    .requiredOption('-t, --timeout <seconds>', 'Timeout period in seconds')
    .option('-c, --cluster <cluster>', 'Cluster (localnet/devnet/testnet/mainnet)', 'devnet')
    .option('-p, --program-id <pubkey>', 'Program ID', PROGRAM_ID.toString())
    .action(async (options) => {
        try {
            const connection = getConnection(options.cluster);
            const buyerKeypair = loadKeypairFromFile(options.buyer);
            const wallet = new Wallet(buyerKeypair);
            const programId = new PublicKey(options.programId);

            const client = await EscrowClient.create(connection, wallet, programId);

            const seller = new PublicKey(options.seller);
            const arbiter = options.arbiter ? new PublicKey(options.arbiter) : undefined;
            const amount = new BN(options.amount);
            const timeoutPeriod = new BN(options.timeout);

            console.log(`\n🚀 Creating escrow...`);
            console.log(`Cluster: ${options.cluster}`);
            console.log(`Buyer: ${buyerKeypair.publicKey.toString()}`);
            console.log(`Seller: ${seller.toString()}`);
            console.log(`Amount: ${amount.toString()} lamports`);
            console.log(`Timeout: ${timeoutPeriod.toString()} seconds\n`);

            const result = await client.initializeEscrow({
                buyer: buyerKeypair.publicKey,
                seller,
                arbiter,
                amount,
                timeoutPeriod,
            });

            console.log(`\n✨ Success!`);
            console.log(`Escrow PDA: ${result.escrowPda.toString()}`);
            console.log(`\n💡 Next step: Fund the escrow with:`);
            console.log(`   solana-escrow-cli fund --escrow ${result.escrowPda.toString()} --buyer ${options.buyer}\n`);
        } catch (error) {
            console.error('❌ Error creating escrow:', error);
            process.exit(1);
        }
    });

// Fund escrow command
program
    .command('fund')
    .description('Fund an existing escrow')
    .requiredOption('-e, --escrow <pubkey>', 'Escrow PDA public key')
    .requiredOption('-b, --buyer <path>', 'Path to buyer keypair')
    .option('-c, --cluster <cluster>', 'Cluster (localnet/devnet/testnet/mainnet)', 'devnet')
    .option('-p, --program-id <pubkey>', 'Program ID', PROGRAM_ID.toString())
    .action(async (options) => {
        try {
            const connection = getConnection(options.cluster);
            const buyerKeypair = loadKeypairFromFile(options.buyer);
            const wallet = new Wallet(buyerKeypair);
            const programId = new PublicKey(options.programId);

            const client = await EscrowClient.create(connection, wallet, programId);
            const escrowPda = new PublicKey(options.escrow);

            console.log(`\n💰 Funding escrow ${escrowPda.toString()}...\n`);

            const signature = await client.fundEscrow(escrowPda, buyerKeypair);

            console.log(`\n✨ Success!`);
        } catch (error) {
            console.error('❌ Error funding escrow:', error);
            process.exit(1);
        }
    });

// Release command
program
    .command('release')
    .description('Release funds to seller')
    .requiredOption('-e, --escrow <pubkey>', 'Escrow PDA public key')
    .requiredOption('-k, --keypair <path>', 'Path to caller keypair (buyer/arbiter/seller)')
    .option('-c, --cluster <cluster>', 'Cluster (localnet/devnet/testnet/mainnet)', 'devnet')
    .option('-p, --program-id <pubkey>', 'Program ID', PROGRAM_ID.toString())
    .action(async (options) => {
        try {
            const connection = getConnection(options.cluster);
            const callerKeypair = loadKeypairFromFile(options.keypair);
            const wallet = new Wallet(callerKeypair);
            const programId = new PublicKey(options.programId);

            const client = await EscrowClient.create(connection, wallet, programId);
            const escrowPda = new PublicKey(options.escrow);

            console.log(`\n🎯 Releasing funds to seller...\n`);

            const signature = await client.releaseToSeller(escrowPda, callerKeypair);

            console.log(`\n✨ Success!`);
        } catch (error) {
            console.error('❌ Error releasing funds:', error);
            process.exit(1);
        }
    });

// Refund command
program
    .command('refund')
    .description('Refund funds to buyer')
    .requiredOption('-e, --escrow <pubkey>', 'Escrow PDA public key')
    .requiredOption('-k, --keypair <path>', 'Path to caller keypair (seller/arbiter)')
    .option('-c, --cluster <cluster>', 'Cluster (localnet/devnet/testnet/mainnet)', 'devnet')
    .option('-p, --program-id <pubkey>', 'Program ID', PROGRAM_ID.toString())
    .action(async (options) => {
        try {
            const connection = getConnection(options.cluster);
            const callerKeypair = loadKeypairFromFile(options.keypair);
            const wallet = new Wallet(callerKeypair);
            const programId = new PublicKey(options.programId);

            const client = await EscrowClient.create(connection, wallet, programId);
            const escrowPda = new PublicKey(options.escrow);

            console.log(`\n↩️  Refunding funds to buyer...\n`);

            const signature = await client.refundToBuyer(escrowPda, callerKeypair);

            console.log(`\n✨ Success!`);
        } catch (error) {
            console.error('❌ Error refunding:', error);
            process.exit(1);
        }
    });

// Cancel command
program
    .command('cancel')
    .description('Cancel an unfunded escrow')
    .requiredOption('-e, --escrow <pubkey>', 'Escrow PDA public key')
    .requiredOption('-k, --keypair <path>', 'Path to caller keypair (buyer/seller)')
    .option('-c, --cluster <cluster>', 'Cluster (localnet/devnet/testnet/mainnet)', 'devnet')
    .option('-p, --program-id <pubkey>', 'Program ID', PROGRAM_ID.toString())
    .action(async (options) => {
        try {
            const connection = getConnection(options.cluster);
            const callerKeypair = loadKeypairFromFile(options.keypair);
            const wallet = new Wallet(callerKeypair);
            const programId = new PublicKey(options.programId);

            const client = await EscrowClient.create(connection, wallet, programId);
            const escrowPda = new PublicKey(options.escrow);

            console.log(`\n❌ Cancelling escrow...\n`);

            const signature = await client.cancelEscrow(escrowPda, callerKeypair);

            console.log(`\n✨ Success!`);
        } catch (error) {
            console.error('❌ Error cancelling escrow:', error);
            process.exit(1);
        }
    });

// Status command
program
    .command('status')
    .description('Get escrow status')
    .requiredOption('-e, --escrow <pubkey>', 'Escrow PDA public key')
    .option('-c, --cluster <cluster>', 'Cluster (localnet/devnet/testnet/mainnet)', 'devnet')
    .option('-p, --program-id <pubkey>', 'Program ID', PROGRAM_ID.toString())
    .action(async (options) => {
        try {
            const connection = getConnection(options.cluster);
            // Use a dummy wallet for read-only operations
            const wallet = new Wallet(Keypair.generate());
            const programId = new PublicKey(options.programId);

            const client = await EscrowClient.create(connection, wallet, programId);
            const escrowPda = new PublicKey(options.escrow);

            await client.displayEscrowState(escrowPda);
        } catch (error) {
            console.error('❌ Error fetching escrow status:', error);
            process.exit(1);
        }
    });

// Generate keypair command
program
    .command('generate-keypair')
    .description('Generate a new keypair')
    .requiredOption('-o, --output <path>', 'Output path for keypair file')
    .action((options) => {
        try {
            createAndSaveKeypair(options.output);
        } catch (error) {
            console.error('❌ Error generating keypair:', error);
            process.exit(1);
        }
    });

program.parse();
