// Overlay determinístico aplicado após a composição clínica e antes do manifesto.
export function applyWeightCorrection(resolved, sourceByPath) {
  function patch(path, change) {
    const prev=Buffer.from(resolved.get(path)||[]).toString('utf8');
    if(!prev)throw new Error('weight correction: arquivo ausente '+path);
    const next=change(prev);
    if(next===prev)throw new Error('weight correction: alteração vazia '+path);
    resolved.set(path,new Uint8Array(Buffer.from(next,'utf8')));
    sourceByPath.set(path,sourceByPath.get(path)+'+weight-correction');
  }
  function once(src,before,after,tag) {
    if(src.split(before).length!==2)throw new Error('weight correction: contrato divergente '+tag);
    return src.replace(before,after);
  }
  patch('core/lib/app-data.js',src=>{
    src=once(src,'  const measuredAt = measuredAtOverride || encounter.occurred_at || encounter.identification?.startsAt || new Date().toISOString();',
      '  const fallbackMeasuredAt = measuredAtOverride || encounter.occurred_at || encounter.identification?.startsAt || new Date().toISOString();','finalization base');
    src=once(src,'    const weight = Number(assessment.weightG || 0);',
      '    const weight = Number(assessment.weightG || 0);\n    const dated = String(assessment.weightMeasuredAt || "");\n    const measuredAt = /^\\d{4}-\\d{2}-\\d{2}$/.test(dated) ? dated + "T12:00:00.000Z" : fallbackMeasuredAt;',
      'dated assessment');
    const line=src.split('\n').find(l=>l.includes('listWeights: (babyId) => repos.weights.list('));
    if(!line)throw new Error('weight correction: listWeights não encontrado');
    const revised=line.replace('listWeights: (babyId) => repos.weights.list(', 'listWeights: async (babyId) => (await repos.weights.list(')
      .replace(' }),',' })).filter(row=>!row.voided_at),');
    return once(src,line,revised,'filter invalid weights');
  });
  patch('core/app-shell.js',src=>{
    const anchor='<label class="field"><span>Ganho desde última avaliação</span>';
    const babyId=String.fromCharCode(36)+'{escapeHTML(baby.id)}';
    src=once(src,anchor,
      '<label class="field"><span>Data real da pesagem</span><input type="date" data-encounter-field="weightMeasuredAt" data-section="baby_assessment" data-baby-id="'+babyId+'"></label>'+anchor,
      'assessment date');
    const start=src.indexOf('async function addWeight() {');
    const end=src.indexOf('\nasync function createFollowup() {',start);
    if(start<0||end<0)throw new Error('weight correction: add-weight não encontrado');
    const replacement=[
      'async function addWeight() {',
      '  const patient=patientByMotherId(currentPatientId);if(!patient)return;',
      '  const baby=babyById(patient,currentBabyId)||familyBabies(patient)[0];if(!baby?.id)return;',
      '  if(!window.DeboraWeightCorrection?.openNew)throw new Error("Editor de peso ainda carregando. Tente novamente.");',
      '  window.DeboraWeightCorrection.openNew({babyId:baby.id});',
      '}'].join('\n');
    src=src.slice(0,start)+replacement+src.slice(end);
    const post='      await appData.addWeight({ baby_id: baby.id, encounter_id: encounter.id, measured_at: startsAt, weight_g: weight });\n      await repositories.babies.update(baby.id, { current_weight_g: weight });';
    src=once(src,post,
      '      const realDate = String(assessment?.weightMeasuredAt || "");\n' +
      '      const measuredAt = /^\\d{4}-\\d{2}-\\d{2}$/.test(realDate) ? realDate + "T12:00:00.000Z" : startsAt;\n' +
      '      await appData.addWeight({ baby_id: baby.id, encounter_id: encounter.id, measured_at: measuredAt, weight_g: weight });',
      'stop current override');
    const bind="appointmentScreen?.addEventListener('change', scheduleEncounterAutosave);";
    src=once(src,bind,bind+"\nwindow.addEventListener('debora:weight-updated',async(event)=>{\n"+
      "  if(!currentPatientId||currentBabyId!==event.detail?.babyId)return;\n"+
      "  try{await refreshData();await openPatient(currentPatientId,{navigateRoute:false,babyId:currentBabyId});}\n"+
      "  catch(error){reportError(error)}\n});",'refresh active baby');
    const validate='  const ident = clinicalState.identification || {};';
    src=once(src,validate,
      '  const today = clinicDayKey(new Date());\n' +
      '  for(const baby of selectedBabies){\n' +
      '    const assessment=clinicalState.baby_assessment?.byBaby?.[baby.id]||(selectedBabies.length===1?clinicalState.baby_assessment:{});\n' +
      '    const date=String(assessment?.weightMeasuredAt||"");\n' +
      '    if(date&&(!/^\\d{4}-\\d{2}-\\d{2}$/.test(date)||date>today))throw new Error("Confira a data real da pesagem.");\n' +
      '  }\n'+validate, 'final validation');
    return src;
  });
}
