//! Errors the person reads, in their language. A command that fails in a way
//! worth explaining answers with a code, `err.<name>`, instead of an English
//! sentence; the interface looks the code up in its translations
//! (`errors.<name>`, see `src/lib/user-error.ts`). Plain codes are written as
//! literals; `coded` adds `|key=value` parameters for the text to fill in.
//!
//! A parameter is shown as text, but it can come from a server (its name, a
//! version), so it loses `|` and control characters and is capped: it can't
//! forge another parameter or flood the message. Never pass a token, a key or
//! an address.

const MAX_VALUE_CHARS: usize = 80;

/// `err.<name>|key=value|…`.
pub fn coded(name: &str, params: &[(&str, &str)]) -> String {
    let mut out = format!("err.{name}");
    for (key, value) in params {
        let clean: String = value.chars().filter(|c| *c != '|' && !c.is_control()).take(MAX_VALUE_CHARS).collect();
        out.push('|');
        out.push_str(key);
        out.push('=');
        out.push_str(clean.trim());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_and_with_parameters() {
        assert_eq!(coded("lists.limit", &[]), "err.lists.limit");
        assert_eq!(coded("lists.limit", &[("max", "50")]), "err.lists.limit|max=50");
        assert_eq!(coded("x", &[("a", "1"), ("b", "two")]), "err.x|a=1|b=two");
    }

    #[test]
    fn a_value_cannot_add_parameters_or_lines() {
        assert_eq!(coded("x", &[("name", "Den|evil=1\n")]), "err.x|name=Denevil=1");
        assert_eq!(coded("x", &[("name", &"a".repeat(500))]).len(), "err.x|name=".len() + MAX_VALUE_CHARS);
    }
}
