// libass shapes mixed Hebrew/English text on Linux as well as Windows.
// Keep user text out of ASS override tags and filter expressions.
const literal = (text: string) => text.replace(/\\/g, "＼").replace(/{/g, "｛").replace(/}/g, "｝").replace(/\r/g, "").replace(/\n/g, "\\N");
const clock = (seconds: number) => {
  const cs = Math.max(0, Math.round(seconds * 100));
  return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, "0")}:${String(Math.floor(cs / 100) % 60).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
};
type Line = { text: string; start: number; end: number };
export function studioSubtitles(title: string, lines: Line[], duration: number, cinematic: boolean, animated: boolean) {
  const y = cinematic ? 1306 : 960;
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Title,DejaVu Sans,38,&H00FFFFFF,&H00FFFFFF,&H88000000,&H88000000,-1,0,0,0,100,100,0,0,1,1,2,8,45,45,0,1
Style: Lyrics,DejaVu Sans,64,&H00FFFFFF,&H00FFFFFF,&H6B190C05,&H88000000,-1,0,0,0,100,100,0,0,${cinematic ? 3 : 1},${cinematic ? 18 : 1},0,5,45,45,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const events = [`Dialogue: 0,0:00:00.00,${clock(Math.min(2.5, duration))},Title,,0,0,0,,{\\pos(540,210)\\fad(100,250)}${literal(title)}`];
  for (const line of lines) {
    const position = animated ? `\\move(540,${y + 24},540,${y},0,350)` : `\\pos(540,${y})`;
    const longest = Math.max(...line.text.split("\n").map(row => row.length));
    const size = Math.min(64, Math.floor(930 / Math.max(1, longest) / .65));
    events.push(`Dialogue: 1,${clock(line.start)},${clock(line.end)},Lyrics,,0,0,0,,{${position}\\fs${size}\\fad(80,70)}${literal(line.text)}`);
  }
  return header + events.join("\n") + "\n";
}
