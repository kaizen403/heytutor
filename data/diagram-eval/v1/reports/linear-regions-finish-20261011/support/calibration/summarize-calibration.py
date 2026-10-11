"""Parent-only reference consistency after all final first grades freeze. No image inspection."""
import argparse
from pathlib import Path
from measurement_core import *

HERE=Path(__file__).resolve().parent

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--calibration-packet',required=True);p.add_argument('--measurement-packet',required=True);p.add_argument('--out',required=True);args=p.parse_args()
 cal=Path(args.calibration_packet).resolve();final=Path(args.measurement_packet).resolve();out=Path(args.out).resolve();require(not out.exists(),'Preserve previous reference-consistency report')
 frozen=read_json(cal/'freeze.json');require(frozen['schema']=='shaded-regions-synthetic-calibration-packet/v1' and frozen['cards']==24,'Wrong reference packet')
 require(sha(cal/'queue.jsonl')==frozen['queueSha256'],'Changed calibration queue');queue=read_jsonl(cal/'queue.jsonl');ids={r['id'] for r in queue};require(len(ids)==24,'Incomplete reference queue')
 parent=HERE/'calibration';contract=read_json(parent/'CALIBRATION-CONTRACT-FREEZE.json')
 require(sha(parent/'CALIBRATION-CONTRACT-FREEZE.json')=='18a32910257775b507baedeb623ba2a51e1b0409544655720a05d2bef25ef0ad','Original reference contract changed')
 require(sha(parent/'parent-reference-grades.jsonl')==contract['referenceGradesSha256'],'Reference gold changed after images')
 gold=read_jsonl(parent/'parent-reference-grades.jsonl');validate_grades(gold,ids);gold={g['id']:g for g in gold}
 # Validate and freeze ALL final A/B/C streams first; never disclose calibration feedback earlier.
 finals={};calibrations={};judges={};names=['right','partial','wrong']
 for judge in ['a','b','c']:
  final_path=final/f'judge-{judge}-first-freeze.json';seal=read_json(final_path)
  require(sha(seal['gradePath'])==seal['gradeSha256'] and sha(seal['identityPath'])==seal['identitySha256'],'Final first grade/identity changed')
  final_queue=read_jsonl(final/'queue.jsonl');validate_grades(read_jsonl(seal['gradePath']),{r['id'] for r in final_queue})
  final_freeze=read_json(final/'freeze.json');require(sha(final/'queue.jsonl')==seal['queueSha256']==final_freeze['queueSha256'],'Final queue changed')
  binding=seal.get('calibration',{});require(Path(binding.get('packetPath','missing')).resolve()==cal and binding.get('packetFreezeSha256')==sha(cal/'freeze.json'),'Final first grades belong to different calibration packet')
  first_path=cal/f'judge-{judge}-first-freeze.json';first=read_json(first_path)
  require(sha(first_path)==binding['firstGradeFreezeSha256'] and first['agentIdentity']==seal['agentIdentity'],'Different calibrated judge')
  require(sha(first['gradePath'])==first['gradeSha256'] and sha(first['identityPath'])==first['identitySha256'],'Calibration grade/identity changed')
  grades=read_jsonl(first['gradePath']);validate_grades(grades,ids)
  finals[judge]={'freezeSha256':sha(final_path),'gradeSha256':seal['gradeSha256'],'agentIdentity':seal['agentIdentity']};calibrations[judge]={'freezeSha256':sha(first_path),'gradeSha256':first['gradeSha256']}
  confusion={expected:{observed:0 for observed in names} for expected in names};families={}
  for grade in grades:
   expected=gold[grade['id']]['verdict'];confusion[expected][grade['verdict']]+=1
   family=next(c['figure_kind'] for c in queue if c['id']==grade['id']);cell=families.setdefault(family,{'n':0,'consistent':0});cell['n']+=1;cell['consistent']+=grade['verdict']==expected
  consistent=sum(confusion[name][name] for name in names)
  judges[judge]={'n':24,'consistent':consistent,'fraction':consistent/24,'referenceByJudgeVerdict':confusion,'families':families}
 require(len({f['agentIdentity'] for f in finals.values()})==3,'Three independent calibrated judges required')
 for card in queue:require(sha(card['cropped_png'])==card['figureSha256'],'Reference image changed')
 report={'schema':'shaded-regions-calibration-consistency-report/v1','at':utc_now(),'n':24,'attribution':'consistency, not human accuracy',
  'referenceProvenance':'Synthetic independently authored maths contracts; complete/annotation-removal/alternate-maths variants; one two-panel optimization exhibit',
  'contractFreezeSha256':sha(parent/'CALIBRATION-CONTRACT-FREEZE.json'),'referenceGradesSha256':sha(parent/'parent-reference-grades.jsonl'),
  'calibrationPacketFreezeSha256':sha(cal/'freeze.json'),'finalFirstGrades':finals,'calibrationFirstGrades':calibrations,'judges':judges,
  'selectionRule':'No quality-based judge replacement, feedback or grade revision; references never adjust readiness gates','rootImageViews':0}
 write_once(out,report);print(canonical({'reportSha256':sha(out),'n':24,'attribution':'consistency, not human accuracy','rootImageViews':0}))

if __name__=='__main__':main()
