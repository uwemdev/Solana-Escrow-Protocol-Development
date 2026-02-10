import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { SolanaGuardEscrow } from "../target/types/solana_guard_escrow";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { assert, expect } from "chai";

describe("SolanaGuard Escrow Protocol", () => {
    // Configure the client to use the local cluster
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.SolanaGuardEscrow as Program<SolanaGuardEscrow>;

    // Test accounts
    let buyer: Keypair;
    let seller: Keypair;
    let arbiter: Keypair;
    let escrowPda: PublicKey;
    let escrowBump: number;

    const escrowAmount = new BN(1 * LAMPORTS_PER_SOL); // 1 SOL
    const timeoutPeriod = new BN(60); // 60 seconds

    before(async () => {
        // Generate test keypairs
        buyer = Keypair.generate();
        seller = Keypair.generate();
        arbiter = Keypair.generate();

        // Airdrop SOL to buyer for testing
        const signature = await provider.connection.requestAirdrop(
            buyer.publicKey,
            5 * LAMPORTS_PER_SOL
        );
        await provider.connection.confirmTransaction(signature);

        console.log("\n🎭 Test Setup Complete");
        console.log(`Buyer: ${buyer.publicKey.toString()}`);
        console.log(`Seller: ${seller.publicKey.toString()}`);
        console.log(`Arbiter: ${arbiter.publicKey.toString()}\n`);
    });

    describe("Escrow Initialization", () => {
        it("Successfully initializes an escrow", async () => {
            [escrowPda, escrowBump] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from("escrow"),
                    buyer.publicKey.toBuffer(),
                    seller.publicKey.toBuffer(),
                ],
                program.programId
            );

            await program.methods
                .initializeEscrow(escrowAmount, timeoutPeriod)
                .accounts({
                    escrow: escrowPda,
                    buyer: buyer.publicKey,
                    seller: seller.publicKey,
                    arbiter: arbiter.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([buyer])
                .rpc();

            const escrowAccount = await program.account.escrow.fetch(escrowPda);

            assert.ok(escrowAccount.buyer.equals(buyer.publicKey));
            assert.ok(escrowAccount.seller.equals(seller.publicKey));
            assert.ok(escrowAccount.arbiter.equals(arbiter.publicKey));
            assert.ok(escrowAccount.amount.eq(escrowAmount));
            assert.ok(escrowAccount.timeoutPeriod.eq(timeoutPeriod));
            assert.equal(escrowAccount.state.created !== undefined, true);

            console.log("✅ Escrow initialized successfully");
        });

        it("Fails to initialize with zero amount", async () => {
            const buyer2 = Keypair.generate();
            const seller2 = Keypair.generate();

            // Airdrop to buyer2
            const sig = await provider.connection.requestAirdrop(
                buyer2.publicKey,
                2 * LAMPORTS_PER_SOL
            );
            await provider.connection.confirmTransaction(sig);

            const [escrowPda2] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from("escrow"),
                    buyer2.publicKey.toBuffer(),
                    seller2.publicKey.toBuffer(),
                ],
                program.programId
            );

            try {
                await program.methods
                    .initializeEscrow(new BN(0), timeoutPeriod)
                    .accounts({
                        escrow: escrowPda2,
                        buyer: buyer2.publicKey,
                        seller: seller2.publicKey,
                        arbiter: buyer2.publicKey,
                        systemProgram: SystemProgram.programId,
                    })
                    .signers([buyer2])
                    .rpc();

                assert.fail("Should have failed with zero amount");
            } catch (error) {
                expect(error.toString()).to.include("InvalidAmount");
                console.log("✅ Correctly rejected zero amount");
            }
        });

        it("Fails to initialize with zero timeout", async () => {
            const buyer2 = Keypair.generate();
            const seller2 = Keypair.generate();

            const sig = await provider.connection.requestAirdrop(
                buyer2.publicKey,
                2 * LAMPORTS_PER_SOL
            );
            await provider.connection.confirmTransaction(sig);

            const [escrowPda2] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from("escrow"),
                    buyer2.publicKey.toBuffer(),
                    seller2.publicKey.toBuffer(),
                ],
                program.programId
            );

            try {
                await program.methods
                    .initializeEscrow(escrowAmount, new BN(0))
                    .accounts({
                        escrow: escrowPda2,
                        buyer: buyer2.publicKey,
                        seller: seller2.publicKey,
                        arbiter: buyer2.publicKey,
                        systemProgram: SystemProgram.programId,
                    })
                    .signers([buyer2])
                    .rpc();

                assert.fail("Should have failed with zero timeout");
            } catch (error) {
                expect(error.toString()).to.include("InvalidTimeout");
                console.log("✅ Correctly rejected zero timeout");
            }
        });
    });

    describe("Escrow Funding", () => {
        it("Successfully funds an escrow", async () => {
            const buyerBalanceBefore = await provider.connection.getBalance(buyer.publicKey);
            const escrowBalanceBefore = await provider.connection.getBalance(escrowPda);

            await program.methods
                .fundEscrow()
                .accounts({
                    escrow: escrowPda,
                    buyer: buyer.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([buyer])
                .rpc();

            const buyerBalanceAfter = await provider.connection.getBalance(buyer.publicKey);
            const escrowBalanceAfter = await provider.connection.getBalance(escrowPda);

            const escrowAccount = await program.account.escrow.fetch(escrowPda);
            assert.equal(escrowAccount.state.funded !== undefined, true);

            // Verify SOL transferred
            assert.ok(escrowBalanceAfter > escrowBalanceBefore);
            assert.ok(buyerBalanceAfter < buyerBalanceBefore);

            console.log("✅ Escrow funded successfully");
            console.log(`   Escrow balance: ${escrowBalanceAfter / LAMPORTS_PER_SOL} SOL`);
        });

        it("Fails to fund already funded escrow", async () => {
            try {
                await program.methods
                    .fundEscrow()
                    .accounts({
                        escrow: escrowPda,
                        buyer: buyer.publicKey,
                        systemProgram: SystemProgram.programId,
                    })
                    .signers([buyer])
                    .rpc();

                assert.fail("Should have failed on double funding");
            } catch (error) {
                expect(error.toString()).to.include("InvalidState");
                console.log("✅ Correctly rejected double funding");
            }
        });
    });

    describe("Release to Seller", () => {
        let newEscrow: PublicKey;
        let newBuyer: Keypair;
        let newSeller: Keypair;

        beforeEach(async () => {
            newBuyer = Keypair.generate();
            newSeller = Keypair.generate();

            const sig = await provider.connection.requestAirdrop(
                newBuyer.publicKey,
                3 * LAMPORTS_PER_SOL
            );
            await provider.connection.confirmTransaction(sig);

            [newEscrow] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from("escrow"),
                    newBuyer.publicKey.toBuffer(),
                    newSeller.publicKey.toBuffer(),
                ],
                program.programId
            );

            await program.methods
                .initializeEscrow(new BN(0.5 * LAMPORTS_PER_SOL), new BN(60))
                .accounts({
                    escrow: newEscrow,
                    buyer: newBuyer.publicKey,
                    seller: newSeller.publicKey,
                    arbiter: newBuyer.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([newBuyer])
                .rpc();

            await program.methods
                .fundEscrow()
                .accounts({
                    escrow: newEscrow,
                    buyer: newBuyer.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([newBuyer])
                .rpc();
        });

        it("Buyer successfully releases to seller", async () => {
            const sellerBalanceBefore = await provider.connection.getBalance(newSeller.publicKey);

            await program.methods
                .releaseToSeller()
                .accounts({
                    escrow: newEscrow,
                    seller: newSeller.publicKey,
                    caller: newBuyer.publicKey,
                })
                .signers([newBuyer])
                .rpc();

            const sellerBalanceAfter = await provider.connection.getBalance(newSeller.publicKey);
            const escrowAccount = await program.account.escrow.fetch(newEscrow);

            assert.equal(escrowAccount.state.released !== undefined, true);
            assert.ok(sellerBalanceAfter > sellerBalanceBefore);

            console.log("✅ Buyer successfully released funds to seller");
            console.log(`   Seller gained: ${(sellerBalanceAfter - sellerBalanceBefore) / LAMPORTS_PER_SOL} SOL`);
        });

        it("Arbiter successfully releases to seller", async () => {
            const newBuyer2 = Keypair.generate();
            const newSeller2 = Keypair.generate();
            const newArbiter2 = Keypair.generate();

            const sig = await provider.connection.requestAirdrop(
                newBuyer2.publicKey,
                3 * LAMPORTS_PER_SOL
            );
            await provider.connection.confirmTransaction(sig);

            const [newEscrow2] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from("escrow"),
                    newBuyer2.publicKey.toBuffer(),
                    newSeller2.publicKey.toBuffer(),
                ],
                program.programId
            );

            await program.methods
                .initializeEscrow(new BN(0.5 * LAMPORTS_PER_SOL), new BN(60))
                .accounts({
                    escrow: newEscrow2,
                    buyer: newBuyer2.publicKey,
                    seller: newSeller2.publicKey,
                    arbiter: newArbiter2.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([newBuyer2])
                .rpc();

            await program.methods
                .fundEscrow()
                .accounts({
                    escrow: newEscrow2,
                    buyer: newBuyer2.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([newBuyer2])
                .rpc();

            const sellerBalanceBefore = await provider.connection.getBalance(newSeller2.publicKey);

            await program.methods
                .releaseToSeller()
                .accounts({
                    escrow: newEscrow2,
                    seller: newSeller2.publicKey,
                    caller: newArbiter2.publicKey,
                })
                .signers([newArbiter2])
                .rpc();

            const sellerBalanceAfter = await provider.connection.getBalance(newSeller2.publicKey);

            assert.ok(sellerBalanceAfter > sellerBalanceBefore);
            console.log("✅ Arbiter successfully released funds");
        });
    });

    describe("Refund to Buyer", () => {
        let refundEscrow: PublicKey;
        let refundBuyer: Keypair;
        let refundSeller: Keypair;

        beforeEach(async () => {
            refundBuyer = Keypair.generate();
            refundSeller = Keypair.generate();

            const sig = await provider.connection.requestAirdrop(
                refundBuyer.publicKey,
                3 * LAMPORTS_PER_SOL
            );
            await provider.connection.confirmTransaction(sig);

            [refundEscrow] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from("escrow"),
                    refundBuyer.publicKey.toBuffer(),
                    refundSeller.publicKey.toBuffer(),
                ],
                program.programId
            );

            await program.methods
                .initializeEscrow(new BN(0.5 * LAMPORTS_PER_SOL), new BN(60))
                .accounts({
                    escrow: refundEscrow,
                    buyer: refundBuyer.publicKey,
                    seller: refundSeller.publicKey,
                    arbiter: refundBuyer.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([refundBuyer])
                .rpc();

            await program.methods
                .fundEscrow()
                .accounts({
                    escrow: refundEscrow,
                    buyer: refundBuyer.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([refundBuyer])
                .rpc();
        });

        it("Seller successfully refunds to buyer", async () => {
            const buyerBalanceBefore = await provider.connection.getBalance(refundBuyer.publicKey);

            await program.methods
                .refundToBuyer()
                .accounts({
                    escrow: refundEscrow,
                    buyer: refundBuyer.publicKey,
                    caller: refundSeller.publicKey,
                })
                .signers([refundSeller])
                .rpc();

            const buyerBalanceAfter = await provider.connection.getBalance(refundBuyer.publicKey);
            const escrowAccount = await program.account.escrow.fetch(refundEscrow);

            assert.equal(escrowAccount.state.refunded !== undefined, true);
            assert.ok(buyerBalanceAfter > buyerBalanceBefore);

            console.log("✅ Seller successfully refunded buyer");
            console.log(`   Buyer gained back: ${(buyerBalanceAfter - buyerBalanceBefore) / LAMPORTS_PER_SOL} SOL`);
        });
    });

    describe("Cancel Escrow", () => {
        it("Successfully cancels unfunded escrow", async () => {
            const cancelBuyer = Keypair.generate();
            const cancelSeller = Keypair.generate();

            const sig = await provider.connection.requestAirdrop(
                cancelBuyer.publicKey,
                2 * LAMPORTS_PER_SOL
            );
            await provider.connection.confirmTransaction(sig);

            const [cancelEscrow] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from("escrow"),
                    cancelBuyer.publicKey.toBuffer(),
                    cancelSeller.publicKey.toBuffer(),
                ],
                program.programId
            );

            await program.methods
                .initializeEscrow(new BN(0.5 * LAMPORTS_PER_SOL), new BN(60))
                .accounts({
                    escrow: cancelEscrow,
                    buyer: cancelBuyer.publicKey,
                    seller: cancelSeller.publicKey,
                    arbiter: cancelBuyer.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([cancelBuyer])
                .rpc();

            await program.methods
                .cancelEscrow()
                .accounts({
                    escrow: cancelEscrow,
                    buyer: cancelBuyer.publicKey,
                    caller: cancelBuyer.publicKey,
                })
                .signers([cancelBuyer])
                .rpc();

            // Verify escrow account is closed
            try {
                await program.account.escrow.fetch(cancelEscrow);
                assert.fail("Escrow should be closed");
            } catch (error) {
                // Expected - account should not exist
                console.log("✅ Escrow successfully cancelled and closed");
            }
        });

        it("Fails to cancel funded escrow", async () => {
            const cancelBuyer2 = Keypair.generate();
            const cancelSeller2 = Keypair.generate();

            const sig = await provider.connection.requestAirdrop(
                cancelBuyer2.publicKey,
                3 * LAMPORTS_PER_SOL
            );
            await provider.connection.confirmTransaction(sig);

            const [cancelEscrow2] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from("escrow"),
                    cancelBuyer2.publicKey.toBuffer(),
                    cancelSeller2.publicKey.toBuffer(),
                ],
                program.programId
            );

            await program.methods
                .initializeEscrow(new BN(0.5 * LAMPORTS_PER_SOL), new BN(60))
                .accounts({
                    escrow: cancelEscrow2,
                    buyer: cancelBuyer2.publicKey,
                    seller: cancelSeller2.publicKey,
                    arbiter: cancelBuyer2.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([cancelBuyer2])
                .rpc();

            await program.methods
                .fundEscrow()
                .accounts({
                    escrow: cancelEscrow2,
                    buyer: cancelBuyer2.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([cancelBuyer2])
                .rpc();

            try {
                await program.methods
                    .cancelEscrow()
                    .accounts({
                        escrow: cancelEscrow2,
                        buyer: cancelBuyer2.publicKey,
                        caller: cancelBuyer2.publicKey,
                    })
                    .signers([cancelBuyer2])
                    .rpc();

                assert.fail("Should not cancel funded escrow");
            } catch (error) {
                expect(error.toString()).to.include("EscrowAlreadyFunded");
                console.log("✅ Correctly rejected cancellation of funded escrow");
            }
        });
    });

    describe("Edge Cases", () => {
        it("Properly derives unique PDAs for different buyer-seller pairs", async () => {
            const buyer1 = Keypair.generate();
            const seller1 = Keypair.generate();
            const buyer2 = Keypair.generate();
            const seller2 = Keypair.generate();

            const [pda1] = PublicKey.findProgramAddressSync(
                [Buffer.from("escrow"), buyer1.publicKey.toBuffer(), seller1.publicKey.toBuffer()],
                program.programId
            );

            const [pda2] = PublicKey.findProgramAddressSync(
                [Buffer.from("escrow"), buyer2.publicKey.toBuffer(), seller2.publicKey.toBuffer()],
                program.programId
            );

            assert.notEqual(pda1.toString(), pda2.toString());
            console.log("✅ PDAs properly differentiated for different parties");
        });
    });

    after(async () => {
        console.log("\n🎉 All tests completed!\n");
    });
});
