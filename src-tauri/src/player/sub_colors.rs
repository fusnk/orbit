//! Subtitle colours with opacity (Settings → Subtitles: text opacity, the
//! box's colour and opacity, the outline's colour), as mpv's `#AARRGGBB`.
//! Colours come from the page only as `#rrggbb`; opacities are clamped, so
//! a hand-edited setting can't hide subtitles or pass anything else to mpv.

use super::check_hex;

/// Text never fades below this (percent): subtitles nobody can read look like a bug.
const TEXT_MIN: u32 = 25;

/// `hex` ("#rrggbb") at `percent` opacity (clamped to 0–100), as mpv's "#AARRGGBB".
pub(crate) fn with_opacity(hex: &str, percent: u32) -> Result<String, String> {
    check_hex(hex)?;
    let alpha = (percent.min(100) * 255 + 50) / 100;
    Ok(format!("#{alpha:02X}{}", hex[1..].to_ascii_uppercase()))
}

/// The text's colour, kept readable.
pub(crate) fn text(hex: &str, percent: u32) -> Result<String, String> {
    with_opacity(hex, percent.max(TEXT_MIN))
}

pub(crate) const fn opacity_default() -> u32 {
    100
}

/// The box Orbit always drew: black at 70% (mpv's #B3000000).
pub(crate) const fn back_opacity_default() -> u32 {
    70
}

pub(crate) fn black() -> String {
    "#000000".into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn colours_take_their_opacity_as_alpha() {
        assert_eq!(with_opacity("#000000", 70).unwrap(), "#B3000000");
        assert_eq!(with_opacity("#ffe14d", 100).unwrap(), "#FFFFE14D");
        assert_eq!(with_opacity("#0b2545", 0).unwrap(), "#000B2545");
        // Clamped, never wrapped.
        assert_eq!(with_opacity("#ffffff", 400).unwrap(), "#FFFFFFFF");
        assert_eq!(text("#ffffff", 0).unwrap(), "#40FFFFFF");
        assert_eq!(text("#ffffff", 50).unwrap(), "#80FFFFFF");
    }

    #[test]
    fn only_plain_hex_colours_reach_mpv() {
        for bad in ["", "#fff", "ffffff", "#ffffff00", "#gggggg", "#ffffff,sub-font=x", "red", "#ffffff\n"] {
            assert!(with_opacity(bad, 100).is_err(), "{bad:?}");
        }
    }
}
