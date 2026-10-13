//! Experimental batched Netscape field scanner. No cookie mutation or policy code.
//! Offsets are UTF-16 units for JS String.slice, not UTF-8 byte offsets.
use std::cell::RefCell;

const MAX_BYTES: usize = 10 * 1024 * 1024;
const MAX_ROWS: usize = 10_000;

fn js_whitespace(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\x0b' | '\x0c' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}

/// Output row layout: line number, HttpOnly bit, field count, 7 start/end pairs.
/// Header contains row count, overflow flag. More than seven fields is invalid.
pub fn scan(text: &str) -> Vec<u32> {
    let mut out = vec![0, 0];
    let mut byte_start = 0;
    let mut utf16_start = 0;
    let mut line_number = 1;
    loop {
        let suffix = &text[byte_start..];
        let length = suffix
            .bytes()
            .position(|b| b == b'\r' || b == b'\n')
            .unwrap_or(suffix.len());
        let line = &suffix[..length];
        let skip = line.chars().all(js_whitespace)
            || (line.starts_with('#') && !line.starts_with("#HttpOnly_"));
        let ascii = line.is_ascii();
        let units = if ascii {
            line.len() as u32
        } else {
            line.encode_utf16().count() as u32
        };
        if !skip {
            out[0] += 1;
            if out[0] as usize > MAX_ROWS {
                out[1] = 1;
                break;
            }
            let http_only = line.starts_with("#HttpOnly_");
            let record = if http_only { &line[10..] } else { line };
            let mut position = utf16_start + if http_only { 10 } else { 0 };
            let mut fields = [0; 14];
            let mut count = 0;
            for field in record.split('\t') {
                let end = position
                    + if ascii {
                        field.len() as u32
                    } else {
                        field.encode_utf16().count() as u32
                    };
                if count < 7 {
                    fields[count * 2] = position;
                    fields[count * 2 + 1] = end;
                }
                count += 1;
                position = end + 1;
            }
            out.extend_from_slice(&[line_number, u32::from(http_only), count as u32]);
            out.extend_from_slice(&fields);
        }
        if length == suffix.len() {
            break;
        }
        let newline = if suffix.as_bytes()[length] == b'\r'
            && suffix.as_bytes().get(length + 1) == Some(&b'\n')
        {
            2
        } else {
            1
        };
        byte_start += length + newline;
        utf16_start += units + newline as u32;
        line_number += 1;
    }
    out
}

#[derive(Default)]
struct State {
    input: Vec<u8>,
    output: Vec<u32>,
}
thread_local! { static STATE: RefCell<State> = RefCell::new(State::default()); }

// Each module instance is private to one dedicated worker. JS fills only the
// allocated input view, then reads the bounded output view. Rust owns both buffers.
#[unsafe(no_mangle)]
pub extern "C" fn input_buffer(length: usize) -> *mut u8 {
    STATE.with(|cell| {
        let mut state = cell.borrow_mut();
        if length > MAX_BYTES {
            return std::ptr::null_mut();
        }
        state.input.resize(length, 0);
        state.input.as_mut_ptr()
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn scan_input() -> usize {
    STATE.with(|cell| {
        let mut state = cell.borrow_mut();
        state.output = match std::str::from_utf8(&state.input) {
            Ok(text) => scan(text),
            Err(_) => vec![0, 2],
        };
        state.output.as_ptr() as usize
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn output_length() -> usize {
    STATE.with(|cell| cell.borrow().output.len())
}

#[unsafe(no_mangle)]
pub extern "C" fn release_buffers() {
    STATE.with(|cell| *cell.borrow_mut() = State::default());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf16_offsets_preserve_astral_characters_and_empty_values() {
        let text = "# comment\r\n#HttpOnly_.example.test\tTRUE\t/\tFALSE\t0\tcat😺\t";
        let rows = scan(text);
        assert_eq!(&rows[..5], &[1, 0, 2, 1, 7]);
        let units: Vec<u16> = text.encode_utf16().collect();
        let name = String::from_utf16(&units[rows[15] as usize..rows[16] as usize]).unwrap();
        assert_eq!(name, "cat😺");
        assert_eq!(rows[17], rows[18]);
    }

    #[test]
    fn whitespace_matches_ecmascript_instead_of_rust_trim() {
        assert_eq!(scan("\u{feff}\n\u{a0}\r\u{2000}\n")[0], 0);
        assert_eq!(scan("\u{85}")[0], 1);
    }

    #[test]
    fn row_limit_is_bounded_even_for_a_huge_number_of_lines() {
        let output = scan(&"a\n".repeat(MAX_ROWS + 50));
        assert_eq!(&output[..2], &[10_001, 1]);
        assert_eq!(output.len(), 2 + MAX_ROWS * 17);
    }
}
