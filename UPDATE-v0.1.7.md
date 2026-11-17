# Ippo to Read v0.1.7

## Page flip blink fix

- Keeps the destination page mounted for the full page-turn lifecycle.
- Removes only the animated outgoing sheet when the turn completes, instead of remounting the destination page.
- Prevents the post-flip white/black blink caused by a fresh image/PDF surface mount.
- Flip behavior remains Paged-mode only and continues to respect LTR/RTL.
