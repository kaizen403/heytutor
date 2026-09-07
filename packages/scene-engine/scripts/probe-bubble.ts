import { familyById } from "../src/dsa/algorithmCatalog";
const run = familyById("bubble_sort")!.run("");
const t = run!.trace;
console.log("frames:", t.frames.length, "result:", JSON.stringify(t.result));
for (const f of t.frames) {
  const st = f.state as any;
  console.log(
    f.id.padEnd(10),
    "[" + st.cells.map((c: any) => (c.mark ? `${c.text}:${c.mark[0]}` : c.text)).join(" ") + "]",
    "ptr=" + (st.pointers ?? []).map((p: any) => `${p.name}@${p.index}`).join(","),
    "bars=" + (st.bars ? st.bars.join(",") : "-"),
    "swap=" + (st.swap ? `${st.swap.from}>${st.swap.to}` : "-"),
    "brk=" + (st.brackets ?? []).map((b: any) => `${b.from}-${b.to}:${b.label}`).join(" "),
    "| " + f.caption,
  );
}
