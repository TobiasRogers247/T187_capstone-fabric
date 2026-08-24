# Energy Market Chaincode

This package contains the first Fabric chaincode slice for the capstone.

## Current Transactions

- `CreateUser(userId, fabricEnrollmentId, initialBalanceCents)`
- `DeactivateUser(userId)`

## User State

Each on-chain user account stores:

- `userId`
- `fabricEnrollmentId`
- `balanceCents`
- `status`
- `createdAt`
- `updatedAt`
- `deactivatedAt`

## Notes

- Balances are stored as integer cents.
- User deletion is modeled as status change to `INACTIVE`.
- Fabric CA identity revocation is handled separately from chaincode state changes.
