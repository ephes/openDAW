// Shared by OS text admission and binary clipboard decoding (including direct callers).
export const CLIPBOARD_MAX_BYTES = 8 * 1024 * 1024
export const CLIPBOARD_MAX_TEXT_LENGTH = 4 * Math.ceil(CLIPBOARD_MAX_BYTES / 3) + 80
