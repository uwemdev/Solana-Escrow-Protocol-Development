import {
    AnchorProvider,
    Program,
    web3,
    BN,
    Wallet,
} from '@coral-xyz/anchor';
import { PublicKey, SystemProgram, Keypair, Connection } from '@solana/web3.js';
import * as fs from 'fs';

// Program ID (will be updated after deployment)
export const PROGRAM_ID = new PublicKey('11111111111111111111111111111111');

/**
 * Escrow state enum matching Rust definition
 */
export enum EscrowState {
    Created = 'Created',
    Funded = 'Funded',
    Released = 'Released',
    Refunded = 'Refunded',
    Cancelled = 'Cancelled',
}

/**
 * Escrow account data structure
 */
export interface Escrow {
    buyer: PublicKey;
    seller: PublicKey;
    arbiter: PublicKey | null;
    amount: BN;
    createdAt: BN;
    timeoutPeriod: BN;
    state: EscrowState;
    bump: number;
}

/**
 * Parameters for initializing an escrow
 */
export interface InitEscrowParams {
    buyer: PublicKey;
    seller: PublicKey;
    arbiter?: PublicKey;
    amount: BN;
    timeoutPeriod: BN;
}

/**
 * SolanaGuard Escrow Client
 * Provides methods to interact with the escrow program
 */
export class EscrowClient {
    constructor(
        public program: Program,
        public provider: AnchorProvider
    ) { }

    /**
     * Create a new EscrowClient instance
     */
    static async create(
        connection: Connection,
        wallet: Wallet,
        programId: PublicKey = PROGRAM_ID
    ): Promise<EscrowClient> {
        const provider = new AnchorProvider(connection, wallet, {
            commitment: 'confirmed',
        });

        // Load IDL (would normally be imported)
        // For this demo, we're creating a minimal structure
        const idl = await Program.fetchIdl(programId, provider);

        if (!idl) {
            throw new Error('IDL not found. Deploy the program first.');
        }

        const program = new Program(idl, programId, provider);

        return new EscrowClient(program, provider);
    }

    /**
     * Derive the escrow PDA address
     */
    deriveEscrowPda(buyer: PublicKey, seller: PublicKey): [PublicKey, number] {
        return PublicKey.findProgramAddressSync(
            [Buffer.from('escrow'), buyer.toBuffer(), seller.toBuffer()],
            this.program.programId
        );
    }

    /**
     * Initialize a new escrow
     */
    async initializeEscrow(params: InitEscrowParams): Promise<{
        signature: string;
        escrowPda: PublicKey;
    }> {
        const { buyer, seller, arbiter, amount, timeoutPeriod } = params;

        const [escrowPda, bump] = this.deriveEscrowPda(buyer, seller);

        const tx = await this.program.methods
            .initializeEscrow(amount, timeoutPeriod)
            .accounts({
                escrow: escrowPda,
                buyer: buyer,
                seller: seller,
                arbiter: arbiter || buyer, // Use buyer as arbiter if none specified
                systemProgram: SystemProgram.programId,
            })
            .rpc();

        console.log(`✅ Escrow initialized: ${escrowPda.toString()}`);
        console.log(`📝 Transaction: ${tx}`);

        return { signature: tx, escrowPda };
    }

    /**
     * Fund an existing escrow
     */
    async fundEscrow(
        escrowPda: PublicKey,
        buyer: Keypair
    ): Promise<string> {
        const escrow = await this.getEscrowState(escrowPda);

        const tx = await this.program.methods
            .fundEscrow()
            .accounts({
                escrow: escrowPda,
                buyer: buyer.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([buyer])
            .rpc();

        console.log(`✅ Escrow funded with ${escrow.amount.toString()} lamports`);
        console.log(`📝 Transaction: ${tx}`);

        return tx;
    }

    /**
     * Release funds to seller
     */
    async releaseToSeller(
        escrowPda: PublicKey,
        caller: Keypair
    ): Promise<string> {
        const escrow = await this.getEscrowState(escrowPda);

        const tx = await this.program.methods
            .releaseToSeller()
            .accounts({
                escrow: escrowPda,
                seller: escrow.seller,
                caller: caller.publicKey,
            })
            .signers([caller])
            .rpc();

        console.log(`✅ Funds released to seller`);
        console.log(`📝 Transaction: ${tx}`);

        return tx;
    }

    /**
     * Refund funds to buyer
     */
    async refundToBuyer(
        escrowPda: PublicKey,
        caller: Keypair
    ): Promise<string> {
        const escrow = await this.getEscrowState(escrowPda);

        const tx = await this.program.methods
            .refundToBuyer()
            .accounts({
                escrow: escrowPda,
                buyer: escrow.buyer,
                caller: caller.publicKey,
            })
            .signers([caller])
            .rpc();

        console.log(`✅ Funds refunded to buyer`);
        console.log(`📝 Transaction: ${tx}`);

        return tx;
    }

    /**
     * Cancel an unfunded escrow
     */
    async cancelEscrow(
        escrowPda: PublicKey,
        caller: Keypair
    ): Promise<string> {
        const escrow = await this.getEscrowState(escrowPda);

        const tx = await this.program.methods
            .cancelEscrow()
            .accounts({
                escrow: escrowPda,
                buyer: escrow.buyer,
                caller: caller.publicKey,
            })
            .signers([caller])
            .rpc();

        console.log(`✅ Escrow cancelled`);
        console.log(`📝 Transaction: ${tx}`);

        return tx;
    }

    /**
     * Get escrow account state
     */
    async getEscrowState(escrowPda: PublicKey): Promise<Escrow> {
        const escrowAccount = await this.program.account.escrow.fetch(escrowPda);
        return escrowAccount as Escrow;
    }

    /**
     * Display escrow state in a readable format
     */
    async displayEscrowState(escrowPda: PublicKey): Promise<void> {
        const escrow = await this.getEscrowState(escrowPda);
        const currentTime = Math.floor(Date.now() / 1000);
        const timeElapsed = currentTime - escrow.createdAt.toNumber();
        const timeRemaining = Math.max(0, escrow.timeoutPeriod.toNumber() - timeElapsed);

        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📋 ESCROW DETAILS');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        console.log(`Escrow Address:  ${escrowPda.toString()}`);
        console.log(`Buyer:           ${escrow.buyer.toString()}`);
        console.log(`Seller:          ${escrow.seller.toString()}`);
        console.log(`Arbiter:         ${escrow.arbiter ? escrow.arbiter.toString() : 'None'}`);
        console.log(`Amount:          ${escrow.amount.toString()} lamports (${(escrow.amount.toNumber() / web3.LAMPORTS_PER_SOL).toFixed(4)} SOL)`);
        console.log(`State:           ${escrow.state}`);
        console.log(`Created:         ${new Date(escrow.createdAt.toNumber() * 1000).toISOString()}`);
        console.log(`Timeout Period:  ${escrow.timeoutPeriod.toString()} seconds`);
        console.log(`Time Elapsed:    ${timeElapsed} seconds`);
        console.log(`Time Remaining:  ${timeRemaining} seconds`);
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    }
}

/**
 * Load keypair from file
 */
export function loadKeypairFromFile(filepath: string): Keypair {
    const secretKey = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

/**
 * Create a new keypair and save to file
 */
export function createAndSaveKeypair(filepath: string): Keypair {
    const keypair = Keypair.generate();
    fs.writeFileSync(filepath, JSON.stringify(Array.from(keypair.secretKey)));
    console.log(`✅ Keypair saved to ${filepath}`);
    console.log(`📍 Public key: ${keypair.publicKey.toString()}`);
    return keypair;
}
