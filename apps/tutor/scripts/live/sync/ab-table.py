import json, statistics, sys
def load(p): return {r['name'].replace('run-',''): r for r in json.load(open(p))}
b=load('baseline.json'); a=load(sys.argv[1] if len(sys.argv)>1 else 'after/after.json')
order=['mirror','projectile','circuit','parabola','dsa','linear']
def med(xs): return int(statistics.median(xs)) if xs else None
rows=[]
for n in order:
    if n not in a: continue
    tb,ta=b[n]['totals'],a[n]['totals']
    def src(t):
        s=t['write_schedule_sources']; tot=sum(s.values()) or 1; return f"{s.get('tts',0)}/{tot}"
    def intro(t):
        i=t.get('intro'); return "none" if not i else f"{i['ink_wall_ms']/1000:.1f}/{i['speech_wall_ms']/1000:.1f}s"
    def lab(t):
        l=t['labels']; return f"{l['in_focus']}/{l['by_write']}/{l['intro']}/{l['post_turn']}"
    rows.append((n, f"{tb['parked_pct']}% -> {ta['parked_pct']}%", f"{src(tb)} -> {src(ta)}",
                 f"{med(tb['write_finish_minus_speech_end_ms'])} -> {med(ta['write_finish_minus_speech_end_ms'])}",
                 f"{intro(tb)} -> {intro(ta)}", f"{lab(tb)} -> {lab(ta)}", f"{tb['focus_count']} -> {ta['focus_count']}"))
print("| lesson | pen parked while voice speaks | rows on exact timings | row finish vs sentence end (median ms) | intro ink/speech | labels focus/writeleak/intro/flush | focus gestures |")
print("|---|---|---|---|---|---|---|")
for r in rows: print("| "+" | ".join(r)+" |")
