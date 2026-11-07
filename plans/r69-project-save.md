# Honest project saves

Verified round-69 O3 against main. Synthetic gated storage tests reproduce lost
dirty state, mutated Save As metadata, missing copied covers and unpersisted cover
removal. The repair uses the existing Web Lock and serialized graph comparison at
completion, with a metadata/cover generation counter. It avoids extending Editing's
public API and conservatively keeps differing graphs dirty until another save.
Local build/lint/tests and a separate review are required before merge.
