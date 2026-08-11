//! Harness-owned parser for the deliberately small JSON Schema subset used
//! by Lab 08. The student implements the compiler and matcher in grammar.rs.

use std::collections::HashSet;

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Field {
    pub name: String,
    pub schema: Schema,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum Schema {
    String,
    StringEnum(Vec<String>),
    Integer {
        minimum: Option<i64>,
        maximum: Option<i64>,
    },
    Boolean,
    Array {
        items: Box<Schema>,
        min_items: usize,
        max_items: usize,
    },
    Object {
        /// Lab 08 emits one canonical property order: the order in the
        /// schema's `properties` object. Every property must be required.
        fields: Vec<Field>,
    },
}

#[derive(Clone, Debug)]
enum JsonValue {
    Null,
    Bool(bool),
    Number(i64),
    String(String),
    Array(Vec<JsonValue>),
    Object(Vec<(String, JsonValue)>),
}

struct JsonParser<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> JsonParser<'a> {
    fn new(source: &'a str) -> Self {
        Self {
            bytes: source.as_bytes(),
            pos: 0,
        }
    }

    fn parse(mut self) -> Result<JsonValue, String> {
        self.skip_ws();
        let value = self.value()?;
        self.skip_ws();
        if self.pos != self.bytes.len() {
            return Err(format!("unexpected byte {} after JSON value", self.pos));
        }
        Ok(value)
    }

    fn skip_ws(&mut self) {
        while matches!(self.bytes.get(self.pos), Some(b' ' | b'\n' | b'\r' | b'\t')) {
            self.pos += 1;
        }
    }

    fn value(&mut self) -> Result<JsonValue, String> {
        self.skip_ws();
        match self.bytes.get(self.pos).copied() {
            Some(b'{') => self.object(),
            Some(b'[') => self.array(),
            Some(b'"') => self.string().map(JsonValue::String),
            Some(b't') => {
                self.literal(b"true")?;
                Ok(JsonValue::Bool(true))
            }
            Some(b'f') => {
                self.literal(b"false")?;
                Ok(JsonValue::Bool(false))
            }
            Some(b'n') => {
                self.literal(b"null")?;
                Ok(JsonValue::Null)
            }
            Some(b'-' | b'0'..=b'9') => self.number().map(JsonValue::Number),
            Some(byte) => Err(format!("unexpected byte {byte:?} at {}", self.pos)),
            None => Err("unexpected end of JSON".into()),
        }
    }

    fn literal(&mut self, expected: &[u8]) -> Result<(), String> {
        if self.bytes.get(self.pos..self.pos + expected.len()) != Some(expected) {
            return Err(format!("invalid literal at byte {}", self.pos));
        }
        self.pos += expected.len();
        Ok(())
    }

    fn object(&mut self) -> Result<JsonValue, String> {
        self.pos += 1;
        self.skip_ws();
        let mut fields = Vec::new();
        if self.bytes.get(self.pos) == Some(&b'}') {
            self.pos += 1;
            return Ok(JsonValue::Object(fields));
        }
        loop {
            self.skip_ws();
            let key = self.string()?;
            self.skip_ws();
            if self.bytes.get(self.pos) != Some(&b':') {
                return Err(format!("expected ':' at byte {}", self.pos));
            }
            self.pos += 1;
            let value = self.value()?;
            if fields.iter().any(|(existing, _)| existing == &key) {
                return Err(format!("duplicate object key {key:?}"));
            }
            fields.push((key, value));
            self.skip_ws();
            match self.bytes.get(self.pos) {
                Some(b',') => self.pos += 1,
                Some(b'}') => {
                    self.pos += 1;
                    break;
                }
                _ => return Err(format!("expected ',' or '}}' at byte {}", self.pos)),
            }
        }
        Ok(JsonValue::Object(fields))
    }

    fn array(&mut self) -> Result<JsonValue, String> {
        self.pos += 1;
        self.skip_ws();
        let mut values = Vec::new();
        if self.bytes.get(self.pos) == Some(&b']') {
            self.pos += 1;
            return Ok(JsonValue::Array(values));
        }
        loop {
            values.push(self.value()?);
            self.skip_ws();
            match self.bytes.get(self.pos) {
                Some(b',') => self.pos += 1,
                Some(b']') => {
                    self.pos += 1;
                    break;
                }
                _ => return Err(format!("expected ',' or ']' at byte {}", self.pos)),
            }
        }
        Ok(JsonValue::Array(values))
    }

    fn string(&mut self) -> Result<String, String> {
        if self.bytes.get(self.pos) != Some(&b'"') {
            return Err(format!("expected string at byte {}", self.pos));
        }
        self.pos += 1;
        let mut out = String::new();
        loop {
            let byte = *self
                .bytes
                .get(self.pos)
                .ok_or_else(|| "unterminated string".to_string())?;
            self.pos += 1;
            match byte {
                b'"' => return Ok(out),
                b'\\' => {
                    let escaped = *self
                        .bytes
                        .get(self.pos)
                        .ok_or_else(|| "unterminated escape".to_string())?;
                    self.pos += 1;
                    match escaped {
                        b'"' => out.push('"'),
                        b'\\' => out.push('\\'),
                        b'/' => out.push('/'),
                        b'b' => out.push('\u{0008}'),
                        b'f' => out.push('\u{000c}'),
                        b'n' => out.push('\n'),
                        b'r' => out.push('\r'),
                        b't' => out.push('\t'),
                        b'u' => {
                            let end = self.pos + 4;
                            let hex = self
                                .bytes
                                .get(self.pos..end)
                                .ok_or_else(|| "short unicode escape".to_string())?;
                            let text =
                                std::str::from_utf8(hex).map_err(|_| "bad unicode escape")?;
                            let code = u32::from_str_radix(text, 16)
                                .map_err(|_| "bad unicode escape digits")?;
                            let ch = char::from_u32(code)
                                .ok_or_else(|| "invalid unicode scalar".to_string())?;
                            out.push(ch);
                            self.pos = end;
                        }
                        _ => return Err(format!("bad string escape at byte {}", self.pos - 1)),
                    }
                }
                0x00..=0x1f => return Err("control byte in JSON string".into()),
                0x20..=0x7f => out.push(byte as char),
                _ => return Err("schema JSON must use ASCII or \\u escapes".into()),
            }
        }
    }

    fn number(&mut self) -> Result<i64, String> {
        let start = self.pos;
        if self.bytes.get(self.pos) == Some(&b'-') {
            self.pos += 1;
        }
        let digit_start = self.pos;
        while matches!(self.bytes.get(self.pos), Some(b'0'..=b'9')) {
            self.pos += 1;
        }
        if self.pos == digit_start {
            return Err(format!("expected integer at byte {start}"));
        }
        if matches!(self.bytes.get(self.pos), Some(b'.' | b'e' | b'E')) {
            return Err("schema numeric keywords must be integers".into());
        }
        std::str::from_utf8(&self.bytes[start..self.pos])
            .map_err(|_| "invalid integer bytes".to_string())?
            .parse::<i64>()
            .map_err(|_| "integer keyword out of range".to_string())
    }
}

fn object(value: &JsonValue) -> Result<&[(String, JsonValue)], String> {
    match value {
        JsonValue::Object(fields) => Ok(fields),
        _ => Err("schema node must be an object".into()),
    }
}

fn get<'a>(fields: &'a [(String, JsonValue)], key: &str) -> Option<&'a JsonValue> {
    fields
        .iter()
        .find(|(name, _)| name == key)
        .map(|(_, value)| value)
}

fn string_value(value: &JsonValue, keyword: &str) -> Result<String, String> {
    match value {
        JsonValue::String(value) => Ok(value.clone()),
        _ => Err(format!("{keyword} must be a string")),
    }
}

fn usize_value(value: Option<&JsonValue>, keyword: &str, default: usize) -> Result<usize, String> {
    match value {
        None => Ok(default),
        Some(JsonValue::Number(value)) if *value >= 0 => {
            usize::try_from(*value).map_err(|_| format!("{keyword} is too large"))
        }
        Some(_) => Err(format!("{keyword} must be a non-negative integer")),
    }
}

fn i64_value(value: Option<&JsonValue>, keyword: &str) -> Result<Option<i64>, String> {
    match value {
        None => Ok(None),
        Some(JsonValue::Number(value)) => Ok(Some(*value)),
        Some(_) => Err(format!("{keyword} must be an integer")),
    }
}

fn build_schema(value: &JsonValue) -> Result<Schema, String> {
    let fields = object(value)?;

    if let Some(enum_value) = get(fields, "enum") {
        let JsonValue::Array(values) = enum_value else {
            return Err("enum must be an array".into());
        };
        if values.is_empty() {
            return Err("enum must not be empty".into());
        }
        let mut variants = Vec::with_capacity(values.len());
        for value in values {
            variants.push(string_value(value, "enum item")?);
        }
        variants.sort();
        variants.dedup();
        return Ok(Schema::StringEnum(variants));
    }

    let kind = string_value(
        get(fields, "type").ok_or_else(|| "schema node needs a string type".to_string())?,
        "type",
    )?;
    match kind.as_str() {
        "string" => Ok(Schema::String),
        "integer" => {
            let minimum = i64_value(get(fields, "minimum"), "minimum")?;
            let maximum = i64_value(get(fields, "maximum"), "maximum")?;
            if matches!((minimum, maximum), (Some(min), Some(max)) if min > max) {
                return Err("minimum must be <= maximum".into());
            }
            Ok(Schema::Integer { minimum, maximum })
        }
        "boolean" => Ok(Schema::Boolean),
        "array" => {
            let item_value =
                get(fields, "items").ok_or_else(|| "array schema needs items".to_string())?;
            let min_items = usize_value(get(fields, "minItems"), "minItems", 0)?;
            let max_items = usize_value(get(fields, "maxItems"), "maxItems", 8)?;
            if min_items > max_items || max_items > 32 {
                return Err("array bounds must satisfy minItems <= maxItems <= 32".into());
            }
            Ok(Schema::Array {
                items: Box::new(build_schema(item_value)?),
                min_items,
                max_items,
            })
        }
        "object" => {
            let properties = object(
                get(fields, "properties")
                    .ok_or_else(|| "object schema needs properties".to_string())?,
            )?;
            let required_value = get(fields, "required")
                .ok_or_else(|| "xgrammar-lite requires an explicit required array".to_string())?;
            let JsonValue::Array(required_values) = required_value else {
                return Err("required must be an array".into());
            };
            let mut required = HashSet::new();
            for item in required_values {
                required.insert(string_value(item, "required item")?);
            }
            let names: HashSet<_> = properties.iter().map(|(name, _)| name.clone()).collect();
            if required != names {
                return Err(
                    "xgrammar-lite canonical objects require every property exactly once".into(),
                );
            }
            if !matches!(
                get(fields, "additionalProperties"),
                Some(JsonValue::Bool(false))
            ) {
                return Err("xgrammar-lite requires additionalProperties: false".into());
            }
            let mut compiled_fields = Vec::with_capacity(properties.len());
            for (name, child) in properties {
                compiled_fields.push(Field {
                    name: name.clone(),
                    schema: build_schema(child)?,
                });
            }
            Ok(Schema::Object {
                fields: compiled_fields,
            })
        }
        other => Err(format!("unsupported schema type {other:?}")),
    }
}

pub fn parse_schema(source: &str) -> Result<Schema, String> {
    build_schema(&JsonParser::new(source).parse()?)
}
