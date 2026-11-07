# Bounded, verifiable sync logs

Verified both O5 defects on main. Version 2 uses the existing binary writer and
WebCrypto SHA-256, validating all records before graph construction. Version 1
requires an explicit unauthenticated-read opt-in. Synthetic fixtures mutate each
digested field, truncate each record prefix, and intercept oversized typed-array
allocation attempts. Local build/lint/tests and separate review gate the merge.
