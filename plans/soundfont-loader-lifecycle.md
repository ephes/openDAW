# Soundfont loader terminal state and generation ownership

Round 63 B7 with coding assistance: late error replay, both library failure paths,
then invalidation fences. Synthetic storage, fetch and library fakes; exercise project
export with synchronous callbacks. Run focused core tests and root build/lint/tests.

Review refinement: retain subscriptions replaying an error so existing device/UI observers receive invalidate retries; export waiters still clean up immediately after terminal replay. A regression covers subscribers joining during failure and observing successful retry.
