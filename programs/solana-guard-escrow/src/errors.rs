use anchor_lang::prelude::*;

/// Custom error codes for the escrow program
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
