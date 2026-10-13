export function cleanName(raw: string) {
  const name = raw.replace(/[\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim();
  if (name.length < 1 || name.length > 24) return null;
  return name;
}

export function nameKey(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function normalizeCode(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    const match = url.pathname.match(/\/r\/([A-Za-z0-9]{4})\/?$/);
    if (match) return match[1].toUpperCase();
  } catch {
    const embedded = trimmed.match(/\/r\/([A-Za-z0-9]{4})\/?$/);
    if (embedded) return embedded[1].toUpperCase();
  }
  const code = trimmed.toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(code)) return null;
  return code;
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function makeRoomCode() {
  let code = "";
  for (let i = 0; i < 4; i += 1) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
}
