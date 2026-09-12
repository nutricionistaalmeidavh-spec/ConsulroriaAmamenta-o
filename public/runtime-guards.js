export function createSingleFlight(){
  const pending=new Map();
  return function singleFlight(key,task){
    if(typeof task!=='function')throw new TypeError('singleFlight task must be a function');
    const normalized=String(key);
    const existing=pending.get(normalized);
    if(existing)return existing;
    let tracked;
    tracked=Promise.resolve().then(task).finally(()=>{
      if(pending.get(normalized)===tracked)pending.delete(normalized);
    });
    pending.set(normalized,tracked);
    return tracked;
  };
}
