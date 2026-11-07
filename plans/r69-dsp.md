# Sample-exact DSP and disposal

Verified round-69 O6 on main. Stationary delays now use the moving path's linear
read interpolation while retaining integer reads. Convolution emits output before
advancing the input block, preserving the declared blockSize latency. No production
compensation caller of FrequencyDomainConvolver exists in this tree. Synthetic
impulse/direct-convolution oracles cover arbitrary splits, ring wrapping, clear
and in-place processing; real observable subscriptions cover tempo-map disposal.
Local build/lint/tests and a separate review are required before merge.
