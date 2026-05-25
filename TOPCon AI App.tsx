import { useState, useEffect, useCallback, useRef } from "react";

// ─── Anthropic API call ───────────────────────────────────────────────────────
async function callClaude(systemPrompt, userMsg, maxTokens = 900) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userMsg }],
    }),
  });
  const data = await res.json();
  return data.content?.map(b => b.text).join("") ?? "";
}

// ─── Palette ──────────────────────────────────────────────────────────────────
const C = {
  bg:"#03080F", surf:"#081524", panel:"#0B1E30", bdr:"#152840",
  accent:"#00D4FF", accdim:"#006880", gold:"#F59E0B",
  green:"#10B981", red:"#EF4444", amber:"#F97316",
  purple:"#A855F7", pink:"#EC4899",
  text:"#E2EEF8", muted:"#3D6080",
};

// ─── Process physics engine (same as before) ──────────────────────────────────
const BASELINE = { Voc:720, Jsc:39.5, FF:83.2, Rs:2.2, Rsh:600, Eta:24.5 };
const STEPS = [
  { key:"tex", label:"Texturing",    short:"TEX", color:"#00D4FF", icon:"◈",
    params:[
      {key:"koh",  label:"KOH Conc.",    unit:"%",    min:0.5,max:4.0, step:0.1,def:1.5,target:1.5,tol:0.3},
      {key:"temp", label:"Bath Temp",    unit:"°C",   min:70, max:95,  step:1,  def:80, target:80, tol:3},
      {key:"time", label:"Etch Time",    unit:"min",  min:10, max:60,  step:1,  def:30, target:30, tol:5},
      {key:"add",  label:"Additive",     unit:"ml/L", min:1,  max:15,  step:0.5,def:5,  target:5,  tol:1},
    ],
    propagate(v){
      const al=[],lk={};
      const kd=v.koh-1.5,td=v.temp-80;
      if(Math.abs(kd)>0.05){
        lk.time={rec:+(30-kd/0.1*0.6).toFixed(1),reason:"−0.6 min per +0.1% KOH"};
        lk.add ={rec:+(5+kd/0.1*0.6).toFixed(1), reason:"+0.6 ml/L per +0.1% KOH (1:3)"};
        if(Math.abs(kd)>0.3)al.push({lvl:"C",msg:`KOH ${kd>0?"↑":"↓"}${Math.abs(kd).toFixed(1)}% → Time MUST ${kd>0?"↓":"↑"}${(Math.abs(kd)/0.1*0.6).toFixed(1)} min | Additive MUST ${kd>0?"↑":"↓"}${(Math.abs(kd)/0.1*0.6).toFixed(1)} ml/L`});
      }
      if(Math.abs(td)>1){
        lk.time={rec:+((lk.time?.rec??30)-td*1.2).toFixed(1),reason:"Arrhenius: −1.2 min/°C"};
        if(Math.abs(td)>3)al.push({lvl:"C",msg:`Temp ${td>0?"↑":"↓"}${Math.abs(td)}°C → Time MUST ${td>0?"↓":"↑"}${(Math.abs(td)*1.2).toFixed(1)} min`});
      }
      return{linked:lk,alerts:al};
    },
    elec(v){
      const oe=Math.max(0,(v.koh-1.5)*2+(v.temp-80)*0.3+(v.time-30)*0.15-0.5);
      return{Voc:{d:-oe*4},Jsc:{d:-oe*0.4},FF:{d:-oe*0.2},Rs:{d:+oe*0.05},Rsh:{d:0},Eta:{d:-oe*0.5}};
    }
  },
  { key:"bor", label:"Boron Diff.", short:"BOR", color:"#10B981", icon:"⬡",
    params:[
      {key:"bcl3", label:"BCl₃ Flow",  unit:"sccm",min:50, max:500, step:5, def:200,target:200,tol:20},
      {key:"o2",   label:"O₂ Flow",    unit:"sccm",min:200,max:2000,step:20,def:800,target:800,tol:80},
      {key:"ft",   label:"Furnace T",  unit:"°C",  min:820,max:950, step:1, def:880,target:880,tol:5},
      {key:"fd",   label:"Diff. Time", unit:"min", min:10, max:60,  step:1, def:25, target:25, tol:3},
    ],
    propagate(v){
      const al=[],lk={};
      const bd=v.bcl3-200,td=v.ft-880;
      if(Math.abs(bd)>5){
        lk.o2={rec:+(800+bd*4).toFixed(0),reason:"O₂:BCl₃=4:1 (stoichiometry)"};
        lk.fd={rec:+Math.max(5,25-(bd/200)*25).toFixed(1),reason:"Dose=Flow×Time=const"};
        al.push({lvl:"C",msg:`BCl₃ ${bd>0?"↑":"↓"}${Math.abs(bd).toFixed(0)}sccm → O₂ MUST ${bd>0?"↑":"↓"}${Math.abs(bd*4).toFixed(0)}sccm | Time MUST ${bd>0?"↓":"↑"}${Math.abs((bd/200)*25).toFixed(1)}min`});
      }
      if(Math.abs(td)>2){
        const rf=Math.exp(td*0.026);
        lk.fd={rec:+Math.max(5,(lk.fd?.rec??25)/rf).toFixed(1),reason:`Ea=3.5eV; +10°C→D↑35%`};
        lk.bcl3={rec:+(v.bcl3*(1-td*0.015)).toFixed(0),reason:"−15% flow per +10°C"};
        if(Math.abs(td)>5)al.push({lvl:"C",msg:`Temp ${td>0?"↑":"↓"}${Math.abs(td)}°C → Time MUST ${td>0?"↓":"↑"}${Math.abs(25-(lk.fd?.rec??25)).toFixed(1)}min | BCl₃ MUST ${td>0?"↓":"↑"}${Math.abs(v.bcl3-(lk.bcl3?.rec??v.bcl3)).toFixed(0)}sccm`});
      }
      return{linked:lk,alerts:al};
    },
    elec(v){
      const n=(800/(v.bcl3/200)/(v.fd/25)/((v.ft-850)*0.005+1))/110;
      const ov=Math.max(0,1-n),un=Math.max(0,n-1);
      return{Voc:{d:ov>0?-ov*18:-un*8},Jsc:{d:ov>0?-ov*0.15:0},FF:{d:un>0?-un*1.5:0},Rs:{d:un>0?+un*0.5:0},Rsh:{d:0},Eta:{d:ov>0?-ov*1.2:-un*0.7}};
    }
  },
  { key:"lpc", label:"LPCVD",        short:"LPC", color:"#F59E0B", icon:"▣",
    params:[
      {key:"sih4", label:"SiH₄ Flow", unit:"sccm", min:30, max:300,step:5, def:100,target:100,tol:10},
      {key:"pr",   label:"Pressure",  unit:"mTorr",min:100,max:500,step:5, def:200,target:200,tol:20},
      {key:"lt",   label:"Furnace T", unit:"°C",   min:550,max:640,step:1, def:580,target:580,tol:5},
      {key:"ld",   label:"Depo Time", unit:"min",  min:10, max:120,step:1, def:45, target:45, tol:5},
    ],
    propagate(v){
      const al=[],lk={};
      const fd=v.sih4-100,td=v.lt-580;
      if(Math.abs(fd)>5){
        lk.ld={rec:+Math.max(10,45*(1-fd/100)).toFixed(1),reason:"Rate∝SiH₄; same thickness"};
        lk.lt={rec:+(580-fd*0.3).toFixed(0),reason:"−3°C/+10sccm (nucleation)"};
        al.push({lvl:"C",msg:`SiH₄ ${fd>0?"↑":"↓"}${Math.abs(fd)}sccm → Time MUST ${fd>0?"↓":"↑"}${Math.abs(45-Math.max(10,45*(1-fd/100))).toFixed(1)}min | Temp MUST ${fd>0?"↓":"↑"}${Math.abs(fd*0.3).toFixed(0)}°C`});
      }
      if(Math.abs(td)>3){
        const rf=Math.exp(td*0.018);
        lk.ld={rec:+Math.max(10,(lk.ld?.rec??45)/rf).toFixed(1),reason:`Arrhenius Ea=1.6eV`};
        if(Math.abs(td)>8)al.push({lvl:"C",msg:`Temp ${td>0?"↑":"↓"}${Math.abs(td)}°C → Rate×${rf.toFixed(2)} → Time MUST ${td>0?"↓":"↑"}${Math.abs(45-(Math.max(10,(lk.ld?.rec??45)))).toFixed(1)}min`});
      }
      return{linked:lk,alerts:al};
    },
    elec(v){
      const thick=3.9*(v.sih4/100)*Math.exp((v.lt-580)*0.018)*v.ld;
      const td=thick-175;
      return{Voc:{d:td<-30?-18:td>30?-5:+2},Jsc:{d:td>30?-0.1:0},FF:{d:0},Rs:{d:td>30?+0.1:0},Rsh:{d:td<-30?-800:+300},Eta:{d:td<-30?-1.0:td>30?-0.3:+0.1}};
    }
  },
  { key:"ald", label:"ALD Al₂O₃",   short:"ALD", color:"#A855F7", icon:"◎",
    params:[
      {key:"tma",   label:"TMA Pulse", unit:"ms", min:5,  max:100,step:1,def:20, target:20, tol:3},
      {key:"purge", label:"N₂ Purge",  unit:"ms", min:50, max:500,step:5,def:100,target:100,tol:10},
      {key:"h2o",   label:"H₂O Pulse", unit:"ms", min:5,  max:100,step:1,def:20, target:20, tol:3},
      {key:"cyc",   label:"Cycles",    unit:"cyc",min:40, max:200,step:5,def:100,target:100,tol:10},
    ],
    propagate(v){
      const al=[],lk={};
      const minP=Math.max(v.tma,v.h2o)*5;
      lk.purge={rec:+minP.toFixed(0),reason:`MUST ≥5×max(TMA,H₂O)=${minP}ms`};
      if(v.purge<minP-10)al.push({lvl:"C",msg:`CRITICAL: Purge ${v.purge}ms < required ${minP}ms → CVD growth → Voc −15 to −30mV!`});
      if(Math.abs(v.tma-20)>2)al.push({lvl:"I",msg:`TMA ${v.tma}ms → Purge MUST be ≥${v.tma*5}ms`});
      const thick=(v.cyc*0.09).toFixed(1);
      lk._thick=thick;
      if(parseFloat(thick)<7)al.push({lvl:"C",msg:`Film ${thick}nm < 7nm → Qf −30% → Voc −10 to −20mV`});
      else if(parseFloat(thick)>15)al.push({lvl:"W",msg:`Film ${thick}nm > 15nm → contact barrier risk`});
      return{linked:lk,alerts:al};
    },
    elec(v){
      const thick=v.cyc*0.09;
      const cvd=v.purge<Math.max(v.tma,v.h2o)*5-10;
      return{Voc:{d:cvd?-22:thick<7?-17:thick>15?-5:+2},Jsc:{d:0},FF:{d:cvd?-1.5:thick>15?-0.8:0},Rs:{d:thick>15?+0.4:0},Rsh:{d:cvd?-2000:thick<7?-800:+500},Eta:{d:cvd?-1.5:thick<7?-1.0:thick>15?-0.5:+0.2}};
    }
  },
  { key:"pec", label:"PECVD SiNₓ",  short:"PEC", color:"#EC4899", icon:"⬢",
    params:[
      {key:"sih4p",label:"SiH₄ Flow",unit:"sccm",min:50, max:400, step:5, def:200,target:200,tol:20},
      {key:"nh3",  label:"NH₃ Flow", unit:"sccm",min:200,max:1200,step:10,def:600,target:600,tol:60},
      {key:"rf",   label:"RF Power", unit:"W",   min:80, max:350, step:5, def:200,target:200,tol:20},
      {key:"pt",   label:"Depo Time",unit:"s",   min:60, max:400, step:5, def:180,target:180,tol:15},
    ],
    propagate(v){
      const al=[],lk={};
      const sd=v.sih4p-200,nd=v.nh3-600;
      if(Math.abs(sd)>5){
        lk.nh3={rec:+(v.sih4p*3).toFixed(0),reason:"SiH₄:NH₃=1:3 FIXED"};
        lk.pt ={rec:+(180*(200/v.sih4p)).toFixed(0),reason:"Rate∝SiH₄; adjust time"};
        al.push({lvl:"C",msg:`SiH₄ ${sd>0?"↑":"↓"}${Math.abs(sd)}sccm → NH₃ MUST ${sd>0?"↑":"↓"}${Math.abs(v.sih4p*3-600).toFixed(0)}sccm | Time MUST ${sd>0?"↓":"↑"}${Math.abs(180-180*(200/v.sih4p)).toFixed(0)}s`});
      }
      if(Math.abs(nd)>10&&Math.abs(sd)<=5){
        lk.sih4p={rec:+(v.nh3/3).toFixed(0),reason:"Si:N=1:3; ΔSiH₄=ΔNH₃÷3"};
        al.push({lvl:"C",msg:`NH₃ ${nd>0?"↑":"↓"}${Math.abs(nd)}sccm → SiH₄ MUST ${nd>0?"↑":"↓"}${Math.abs(v.nh3/3-200).toFixed(0)}sccm`});
      }
      const ri=2.02+(v.sih4p/v.nh3-200/600)*3.1;
      lk._ri=ri.toFixed(3);
      if(ri>2.08)al.push({lvl:"C",msg:`RI=${ri.toFixed(2)} (Si-rich) → Jsc −0.3 to −0.5mA/cm²`});
      else if(ri<1.95)al.push({lvl:"W",msg:`RI=${ri.toFixed(2)} (N-rich) → ARC performance lost`});
      if(v.rf>240)al.push({lvl:"C",msg:`RF ${v.rf}W > 240W → plasma damage → Voc −5 to −15mV`});
      return{linked:lk,alerts:al};
    },
    elec(v){
      const ri=2.02+(v.sih4p/v.nh3-200/600)*3.1;
      const thick=(78/180)*(v.sih4p/200)*(v.rf/200)**0.8*v.pt;
      const arcL=Math.abs(thick-78)*0.06;
      const rfD=v.rf>240?(v.rf-240)*0.06:0;
      return{Voc:{d:-rfD*0.1},Jsc:{d:-(arcL+(ri>2.08?(ri-2.08)*5:ri<1.95?(1.95-ri)*4:0)*0.05)},FF:{d:-rfD*0.05},Rs:{d:0},Rsh:{d:-rfD*100},Eta:{d:-(arcL*0.04+rfD*0.04)}};
    }
  },
  { key:"fir", label:"Co-Firing",   short:"FIR", color:"#F97316", icon:"🔥",
    params:[
      {key:"peak",   label:"Peak Temp", unit:"°C",   min:740,max:860,step:1,   def:795,target:795,tol:5},
      {key:"belt",   label:"Belt Speed",unit:"m/min",min:3.0,max:9.0,step:0.05,def:5.7,target:5.7,tol:0.2},
      {key:"preheat",label:"Pre-heat",  unit:"°C",   min:300,max:500,step:5,   def:400,target:400,tol:15},
    ],
    propagate(v){
      const al=[],lk={};
      const td=v.peak-795,sd=v.belt-5.7;
      if(Math.abs(td)>3){
        lk.belt   ={rec:+(5.7*(1+td/(795+273))).toFixed(2),reason:"Budget=T×Dwell=const"};
        lk.preheat={rec:+(400+td).toFixed(0),reason:"Maintain ramp rate"};
        if(td>5)al.push({lvl:"C",msg:`Peak ↑${td}°C → Belt MUST ↑ to ${(5.7*(1+td/(795+273))).toFixed(2)}m/min | Pre-heat MUST ↑ to ${(400+td).toFixed(0)}°C`});
        else al.push({lvl:"W",msg:`Peak ${td>0?"↑":"↓"}${Math.abs(td)}°C → Belt should ${td>0?"↑":"↓"} to ${(5.7*(1+td/(795+273))).toFixed(2)}m/min`});
      }
      if(Math.abs(sd)>0.1&&Math.abs(td)<=3){
        const nt=+(795*Math.pow(v.belt/5.7,0.85)).toFixed(0);
        lk.peak={rec:nt,reason:"T_new=T_old×(v_new/v_old)^0.85"};
        al.push({lvl:"C",msg:`Belt ${sd>0?"↑":"↓"}${Math.abs(sd).toFixed(2)}m/min → Peak MUST ${sd>0?"↑":"↓"} to ${nt}°C`});
      }
      const br=((v.peak+273)*(1/v.belt))/((795+273)*(1/5.7));
      lk._budget=br.toFixed(3);
      if(br>1.05)al.push({lvl:"C",msg:`⚠ OVER-FIRE: ${((br-1)*100).toFixed(1)}% excess → Ag spikes → Rsh collapse → FF −3 to −5%!`});
      else if(br<0.95)al.push({lvl:"W",msg:`UNDER-FIRE: ${((1-br)*100).toFixed(1)}% deficit → Rs ↑1–2mΩ → FF −2 to −4%`});
      return{linked:lk,alerts:al};
    },
    elec(v){
      const br=((v.peak+273)*(1/v.belt))/((795+273)*(1/5.7));
      const ov=Math.max(0,br-1),un=Math.max(0,1-br);
      return{Voc:{d:ov>0.05?-ov*250:0},Jsc:{d:0},FF:{d:ov>0.03?-ov*60:-un*35},Rs:{d:un>0.02?+un*15:0},Rsh:{d:ov>0.04?-ov*50000:0},Eta:{d:ov>0.03?-ov*15:-un*10}};
    }
  },
];

// ─── Global state helpers ─────────────────────────────────────────────────────
function initVals() {
  const v = {};
  STEPS.forEach(s => { v[s.key]={}; s.params.forEach(p=>{ v[s.key][p.key]=p.def; }); });
  return v;
}
function getAllElec(vals) {
  return STEPS.map(s => s.elec(vals[s.key]));
}
function getTotalEta(vals) {
  return BASELINE.Eta + getAllElec(vals).reduce((s,e)=>s+(e.Eta?.d??0),0);
}
function getStepFin(vals,stepKey) {
  const s=STEPS.find(x=>x.key===stepKey); const e=s.elec(vals[stepKey]);
  return { Voc:BASELINE.Voc+(e.Voc?.d??0), Jsc:BASELINE.Jsc+(e.Jsc?.d??0), FF:BASELINE.FF+(e.FF?.d??0), Rs:BASELINE.Rs+(e.Rs?.d??0), Rsh:BASELINE.Rsh+(e.Rsh?.d??0), Eta:BASELINE.Eta+(e.Eta?.d??0) };
}

// ─── UI Atoms ─────────────────────────────────────────────────────────────────
const mono = { fontFamily:"'Share Tech Mono',monospace" };
const raj  = { fontFamily:"'Rajdhani',sans-serif" };

function Divider({ label }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:8, margin:"14px 0 8px" }}>
      <div style={{ flex:1, height:1, background:C.bdr }} />
      <span style={{ ...raj, fontSize:9, letterSpacing:3, color:C.muted, textTransform:"uppercase" }}>{label}</span>
      <div style={{ flex:1, height:1, background:C.bdr }} />
    </div>
  );
}

function Chip({ color, children, small }) {
  return (
    <span style={{ ...raj, fontSize:small?8:10, fontWeight:700, letterSpacing:1,
      padding:small?"2px 6px":"3px 9px", borderRadius:20, textTransform:"uppercase",
      background:`${color}22`, color, border:`1px solid ${color}44` }}>{children}</span>
  );
}

function AlertBox({ lvl, msg }) {
  const map={C:[C.red,"⚠ CRITICAL"],W:[C.amber,"▲ WARNING"],I:[C.accent,"ℹ INFO"]};
  const [col,title]=map[lvl]??map.I;
  return (
    <div style={{ background:`${col}0D`, borderLeft:`3px solid ${col}`, borderRadius:"0 8px 8px 0",
      padding:"9px 12px", marginBottom:7, fontSize:11, lineHeight:1.5, color:`${col}DD` }}>
      <div style={{ ...raj, fontWeight:700, fontSize:12, letterSpacing:1, marginBottom:2 }}>{title}</div>
      {msg}
    </div>
  );
}

function KPI({ label, val, base, dec, color, unit }) {
  const d = val - base;
  const pos = d > 0;
  return (
    <div style={{ background:C.surf, border:`1px solid ${C.bdr}`, borderRadius:10, padding:"10px 8px" }}>
      <div style={{ ...raj, fontSize:8, color:C.muted, letterSpacing:2, textTransform:"uppercase", marginBottom:3 }}>{label}</div>
      <div style={{ ...mono, fontSize:20, fontWeight:700, color, lineHeight:1 }}>{val.toFixed(dec)}</div>
      <div style={{ ...mono, fontSize:10, color:d===0?C.muted:pos?C.green:C.red, marginTop:2 }}>
        {d===0?"±0":(pos?"+":"")+d.toFixed(dec)} {unit}
      </div>
    </div>
  );
}

function Loader({ text }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:12, padding:"32px 20px" }}>
      <div style={{ width:40, height:40, borderRadius:"50%",
        border:`3px solid ${C.bdr}`, borderTopColor:C.accent,
        animation:"spin 0.8s linear infinite" }} />
      <span style={{ ...raj, fontSize:12, color:C.muted, letterSpacing:2, textAlign:"center" }}>{text}</span>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

function AiResponse({ text }) {
  if (!text) return null;
  return (
    <div style={{ background:`linear-gradient(135deg,${C.accent}08,${C.purple}08)`,
      border:`1px solid ${C.accent}33`, borderRadius:12, padding:"14px 14px", marginTop:12 }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
        <div style={{ width:24, height:24, borderRadius:6,
          background:`linear-gradient(135deg,${C.accent},${C.purple})`,
          display:"flex", alignItems:"center", justifyContent:"center", fontSize:14 }}>✦</div>
        <span style={{ ...raj, fontSize:11, fontWeight:700, letterSpacing:2, color:C.accent }}>AI ANALYSIS</span>
      </div>
      <div style={{ fontSize:12, lineHeight:1.7, color:"#C8E0F0", whiteSpace:"pre-wrap" }}>{text}</div>
    </div>
  );
}

// ─── CALCULATOR MODULE ─────────────────────────────────────────────────────────
function CalcModule({ vals, setVals }) {
  const [stepIdx, setStepIdx] = useState(0);
  const navRef = useRef(null);
  const step = STEPS[stepIdx];
  const sv = vals[step.key];
  const prop = step.propagate(sv);
  const elec = step.elec(sv);
  const fin = getStepFin(vals, step.key);
  const allElec = getAllElec(vals);
  const totalEta = getTotalEta(vals);

  function update(pk, v) {
    const p=step.params.find(x=>x.key===pk);
    setVals(prev=>({...prev,[step.key]:{...prev[step.key],[pk]:Math.min(p.max,Math.max(p.min,v))}}));
  }
  function stepV(pk,dir){ const p=step.params.find(x=>x.key===pk); update(pk,vals[step.key][pk]+dir*p.step); }

  useEffect(()=>{ navRef.current?.children[stepIdx]?.scrollIntoView({behavior:"smooth",block:"nearest",inline:"center"}); },[stepIdx]);

  const etaC = totalEta>=24.5?C.green:totalEta>=24.0?C.amber:C.red;

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
      {/* Step nav */}
      <div ref={navRef} style={{ display:"flex", overflowX:"auto", flexShrink:0,
        background:C.surf, borderBottom:`1px solid ${C.bdr}`,
        WebkitOverflowScrolling:"touch", scrollbarWidth:"none" }}>
        {STEPS.map((s,i)=>{
          const hasAlert=s.propagate(vals[s.key]).alerts.some(a=>a.lvl==="C"||a.lvl==="W");
          const active=i===stepIdx;
          return(
            <button key={s.key} onClick={()=>setStepIdx(i)}
              style={{ flexShrink:0, padding:"8px 13px", border:"none", background:"transparent",
                cursor:"pointer", ...raj, fontWeight:600, fontSize:11, letterSpacing:1,
                textTransform:"uppercase", color:active?s.color:hasAlert?C.amber:C.muted,
                borderBottom:`2px solid ${active?s.color:"transparent"}`,
                whiteSpace:"nowrap", transition:"all 0.15s", position:"relative" }}>
              {s.label}
              {hasAlert&&<span style={{ position:"absolute", top:5, right:4, width:5, height:5, borderRadius:"50%", background:C.red }} />}
            </button>
          );
        })}
      </div>

      {/* Scroll content */}
      <div style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch", padding:"12px 14px 24px" }}>
        {/* Params */}
        {step.params.map(p=>{
          const val=sv[p.key];
          const inTol=Math.abs(val-p.target)<=p.tol;
          const link=prop.linked[p.key];
          const pct=((val-p.min)/(p.max-p.min)*100).toFixed(1);
          const tpct=((p.target-p.min)/(p.max-p.min)*100).toFixed(1);
          return(
            <div key={p.key} style={{ background:C.surf, border:`1px solid ${link?C.accent:inTol?C.bdr:C.amber}33`,
              borderRadius:12, padding:13, marginBottom:10, position:"relative", overflow:"hidden" }}>
              {link&&<div style={{ position:"absolute",top:0,left:0,right:0,height:2,background:C.accent }}/>}
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                <div>
                  <div style={{ fontSize:13, fontWeight:600, marginBottom:2 }}>{p.label}</div>
                  {!inTol&&<Chip color={C.amber} small>out of spec</Chip>}
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <button onClick={()=>stepV(p.key,-1)} style={{ width:30,height:30,borderRadius:7,border:`1px solid ${C.bdr}`,background:C.panel,color:C.accent,fontSize:20,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",...raj,fontWeight:700,lineHeight:1 }}>−</button>
                  <div style={{ ...mono, fontSize:14, color:C.accent, minWidth:70, textAlign:"center" }}>
                    {typeof val==="number"&&Math.abs(val)<10?val.toFixed(Math.abs(val)<2?2:1):Math.round(val)} <span style={{ fontSize:9, color:C.muted }}>{p.unit}</span>
                  </div>
                  <button onClick={()=>stepV(p.key,+1)} style={{ width:30,height:30,borderRadius:7,border:`1px solid ${C.bdr}`,background:C.panel,color:C.accent,fontSize:20,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",...raj,fontWeight:700,lineHeight:1 }}>+</button>
                </div>
              </div>
              <div style={{ position:"relative", margin:"8px 0 4px" }}>
                <div style={{ position:"absolute",top:-14,left:`${tpct}%`,transform:"translateX(-50%)",fontSize:8,color:C.gold,...raj,whiteSpace:"nowrap" }}>▲{p.target}</div>
                <input type="range" min={p.min} max={p.max} step={p.step} value={val}
                  onChange={e=>update(p.key,parseFloat(e.target.value))}
                  style={{ WebkitAppearance:"none",appearance:"none",width:"100%",height:5,borderRadius:3,outline:"none",cursor:"pointer",margin:0,
                    background:`linear-gradient(to right,${inTol?C.accent:C.amber} ${pct}%,${C.bdr} ${pct}%)` }}/>
                <div style={{ position:"absolute",top:-3,left:`${tpct}%`,transform:"translateX(-50%)",width:2,height:11,background:C.gold,borderRadius:1,pointerEvents:"none" }}/>
              </div>
              <div style={{ display:"flex",justifyContent:"space-between",...mono,fontSize:9,color:C.muted,marginTop:4 }}>
                <span>{p.min}</span><span style={{ color:C.gold }}>▲{p.target}{p.unit}</span><span>{p.max}</span>
              </div>
              {link&&(
                <div style={{ display:"flex",alignItems:"center",gap:6,background:`${C.accent}0D`,border:`1px solid ${C.accent}33`,borderRadius:8,padding:"7px 10px",marginTop:9 }}>
                  <span style={{ color:C.accent,fontSize:13 }}>↳</span>
                  <span style={{ fontSize:11,color:C.accent,flex:1 }}>{link.reason}</span>
                  <span style={{ ...mono,fontSize:13,color:C.gold,fontWeight:700 }}>{link.rec} {p.unit}</span>
                </div>
              )}
            </div>
          );
        })}

        {/* Extra info */}
        {prop.linked._thick&&<div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",background:`${C.accent}0D`,border:`1px solid ${C.accent}22`,borderRadius:8,padding:"7px 12px",marginBottom:8 }}><span style={{ fontSize:12,color:C.muted }}>Calculated Film Thickness</span><span style={{ ...mono,fontSize:14,color:C.gold,fontWeight:700 }}>{prop.linked._thick} nm</span></div>}
        {prop.linked._ri&&<div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",background:`${C.accent}0D`,border:`1px solid ${C.accent}22`,borderRadius:8,padding:"7px 12px",marginBottom:8 }}><span style={{ fontSize:12,color:C.muted }}>Refractive Index (RI)</span><span style={{ ...mono,fontSize:14,fontWeight:700,color:parseFloat(prop.linked._ri)>2.08?C.red:parseFloat(prop.linked._ri)<1.95?C.amber:C.green }}>{prop.linked._ri}</span></div>}
        {prop.linked._budget&&<div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",background:`${C.accent}0D`,border:`1px solid ${C.accent}22`,borderRadius:8,padding:"7px 12px",marginBottom:8 }}><span style={{ fontSize:12,color:C.muted }}>Thermal Budget Ratio</span><span style={{ ...mono,fontSize:14,fontWeight:700,color:parseFloat(prop.linked._budget)>1.05?C.red:parseFloat(prop.linked._budget)<0.95?C.amber:C.green }}>{prop.linked._budget}</span></div>}

        {/* Alerts */}
        {prop.alerts.length>0&&<><Divider label="Process Alerts"/>{prop.alerts.map((a,i)=><AlertBox key={i} {...a}/>)}</>}

        {/* KPIs */}
        <Divider label="Cell Electrical Output"/>
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12 }}>
          {[{k:"Voc",l:"Voc",u:"mV",v:fin.Voc,b:720,d:1,c:"#4FC3F7"},{k:"Jsc",l:"Jsc",u:"mA/cm²",v:fin.Jsc,b:39.5,d:2,c:"#81C784"},{k:"FF",l:"FF",u:"%",v:fin.FF,b:83.2,d:1,c:"#CE93D8"},{k:"Rs",l:"Rs",u:"mΩ",v:fin.Rs,b:2.2,d:2,c:"#FFCC02"},{k:"Rsh",l:"Rsh",u:"Ω",v:fin.Rsh,b:600,d:0,c:"#80CBC4"},{k:"Eta",l:"Eta",u:"%",v:fin.Eta,b:24.5,d:2,c:C.gold}].map(k=><KPI key={k.k} label={k.l} val={k.v} base={k.b} dec={k.d} color={k.c} unit={k.u}/>)}
        </div>

        {/* Impact breakdown */}
        <Divider label="This Step Impact"/>
        <div style={{ background:C.surf,border:`1px solid ${C.bdr}`,borderRadius:12,padding:"10px 14px" }}>
          {["Voc","Jsc","FF","Rs","Rsh","Eta"].map(k=>{
            const d=elec[k]?.d??0;
            const u={Voc:"mV",Jsc:"mA",FF:"%",Rs:"mΩ",Rsh:"Ω",Eta:"%"}[k];
            const col=d>0?C.green:d<0?C.red:C.muted;
            return(
              <div key={k} style={{ display:"flex",alignItems:"center",gap:8,padding:"7px 0",borderBottom:`1px solid ${C.grid}` }}>
                <span style={{ ...mono,fontSize:12,fontWeight:700,color:col,width:28 }}>{k}</span>
                <span style={{ ...mono,fontSize:13,fontWeight:700,color:col,width:90 }}>{d===0?"≈ 0":`${d>0?"+":""}${d.toFixed(2)} ${u}`}</span>
                <div style={{ flex:1,height:4,background:C.bdr,borderRadius:2,overflow:"hidden" }}>
                  <div style={{ height:"100%",width:`${Math.min(100,Math.abs(d)*6)}%`,background:col,borderRadius:2,transition:"width 0.4s" }}/>
                </div>
              </div>
            );
          })}
        </div>

        {/* Live Eta */}
        <div style={{ background:`${etaC}11`,border:`1px solid ${etaC}44`,borderRadius:12,padding:"14px",marginTop:12,textAlign:"center" }}>
          <div style={{ ...raj,fontSize:9,color:C.muted,letterSpacing:3,textTransform:"uppercase",marginBottom:4 }}>LIVE COMBINED ETA (ALL STEPS)</div>
          <div style={{ ...mono,fontSize:32,fontWeight:700,color:etaC }}>{totalEta.toFixed(2)}%</div>
          <div style={{ ...mono,fontSize:11,color:C.muted,marginTop:2 }}>vs baseline 24.50% ({(totalEta-24.5)>=0?"+":""}{(totalEta-24.5).toFixed(2)}%)</div>
        </div>
      </div>
    </div>
  );
}

// ─── AI RECIPE OPTIMIZER ──────────────────────────────────────────────────────
function AIRecipeOptimizer({ vals }) {
  const [goal, setGoal] = useState("maximize Eta above 25%");
  const [constraint, setConstraint] = useState("keep FF > 83%");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState("");

  const currentState = STEPS.map(s => {
    const e = s.elec(vals[s.key]);
    return `${s.label}: ${s.params.map(p=>`${p.label}=${vals[s.key][p.key]}${p.unit}`).join(", ")} → Eta impact: ${(e.Eta?.d??0).toFixed(2)}%`;
  }).join("\n");

  async function optimize() {
    setLoading(true); setResult("");
    try {
      const res = await callClaude(
        `You are an expert TOPCon solar cell process engineer at a top Chinese manufacturer (LONGi, Jinko, Trina level). 
You optimize process recipes to maximize cell efficiency. You understand process physics deeply.
Respond in this EXACT format:
1. DIAGNOSIS: Current recipe analysis (2-3 sentences)
2. TOP 3 OPTIMIZATIONS: Each with: Parameter → FROM → TO → Expected Eta gain
3. CAUTIONS: What to watch out for
4. PREDICTED OUTCOME: New Eta estimate
Be very specific with numbers. Use engineering language.`,
        `Current TOPCon process state:\n${currentState}\n\nOptimization goal: ${goal}\nConstraint: ${constraint}\n\nProvide specific recipe recommendations.`,
        800
      );
      setResult(res);
    } catch(e) { setResult("API error. Check connection."); }
    setLoading(false);
  }

  return (
    <div style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch", padding:"14px 14px 24px" }}>
      <div style={{ background:`linear-gradient(135deg,${C.accent}15,${C.purple}15)`, border:`1px solid ${C.accent}33`, borderRadius:12, padding:14, marginBottom:14 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
          <div style={{ width:36, height:36, borderRadius:10, background:`linear-gradient(135deg,${C.accent},${C.purple})`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20 }}>✦</div>
          <div>
            <div style={{ ...raj, fontSize:16, fontWeight:700, color:C.accent, letterSpacing:2 }}>AI RECIPE OPTIMIZER</div>
            <div style={{ fontSize:10, color:C.muted }}>Claude AI · Process Physics Engine</div>
          </div>
        </div>

        <div style={{ marginBottom:10 }}>
          <div style={{ ...raj, fontSize:10, letterSpacing:2, color:C.muted, marginBottom:5 }}>OPTIMIZATION GOAL</div>
          <input value={goal} onChange={e=>setGoal(e.target.value)}
            style={{ width:"100%", background:C.panel, border:`1px solid ${C.bdr}`, borderRadius:8, padding:"10px 12px", color:C.text, fontSize:13, outline:"none", fontFamily:"'Exo 2',sans-serif" }}
            placeholder="e.g. maximize Eta above 25%" />
        </div>
        <div style={{ marginBottom:14 }}>
          <div style={{ ...raj, fontSize:10, letterSpacing:2, color:C.muted, marginBottom:5 }}>CONSTRAINT</div>
          <input value={constraint} onChange={e=>setConstraint(e.target.value)}
            style={{ width:"100%", background:C.panel, border:`1px solid ${C.bdr}`, borderRadius:8, padding:"10px 12px", color:C.text, fontSize:13, outline:"none", fontFamily:"'Exo 2',sans-serif" }}
            placeholder="e.g. keep FF > 83%, Rs < 2.5 mΩ" />
        </div>

        <button onClick={optimize} disabled={loading}
          style={{ width:"100%", padding:"13px", borderRadius:10, border:"none", cursor:"pointer",
            background:loading?C.panel:`linear-gradient(135deg,${C.accdim},${C.accent})`,
            color:loading?C.muted:"#000", ...raj, fontWeight:700, fontSize:14, letterSpacing:2 }}>
          {loading?"ANALYZING...":"✦ OPTIMIZE RECIPE"}
        </button>
      </div>

      {/* Current summary */}
      <Divider label="Current Recipe State"/>
      {STEPS.map(s=>{
        const e=s.elec(vals[s.key]);
        const d=e.Eta?.d??0;
        return(
          <div key={s.key} style={{ display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:`1px solid ${C.grid}` }}>
            <div style={{ width:3,height:28,borderRadius:2,background:s.color,flexShrink:0 }}/>
            <div style={{ flex:1 }}>
              <div style={{ ...raj,fontSize:12,fontWeight:600 }}>{s.label}</div>
              <div style={{ fontSize:10,color:C.muted }}>{s.params.slice(0,2).map(p=>`${p.label}: ${vals[s.key][p.key]}${p.unit}`).join(" · ")}</div>
            </div>
            <div style={{ ...mono,fontSize:13,fontWeight:700,color:d>0?C.green:d<0?C.red:C.muted }}>{d>=0?"+":""}{d.toFixed(2)}%</div>
          </div>
        );
      })}

      {loading && <Loader text="AI analyzing your recipe against 1000+ process combinations..."/>}
      {result && <AiResponse text={result}/>}
    </div>
  );
}

// ─── YIELD PREDICTOR ──────────────────────────────────────────────────────────
function YieldPredictor({ vals }) {
  const [wafersIn, setWafersIn] = useState(10000);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState("");
  const [localYield, setLocalYield] = useState(null);

  function computeYield() {
    const allE = getAllElec(vals);
    const totalEta = getTotalEta(vals);
    const alerts = STEPS.flatMap(s=>s.propagate(vals[s.key]).alerts);
    const critCount = alerts.filter(a=>a.lvl==="C").length;
    const warnCount = alerts.filter(a=>a.lvl==="W").length;

    const baseYield = 99.5;
    const etaPenalty = Math.max(0, (24.0 - totalEta) * 5);
    const alertPenalty = critCount * 2.5 + warnCount * 0.8;
    const predictedYield = Math.max(85, baseYield - etaPenalty - alertPenalty);
    const etaBins = {
      "≥25.0%": Math.round(wafersIn * Math.max(0, (totalEta-25.0)/1.5) * (predictedYield/100) * 0.3),
      "24.5–25.0%": Math.round(wafersIn * 0.35 * (predictedYield/100)),
      "24.0–24.5%": Math.round(wafersIn * 0.30 * (predictedYield/100)),
      "23.5–24.0%": Math.round(wafersIn * 0.20 * (predictedYield/100)),
      "<23.5% (scrap)": Math.round(wafersIn * (1-predictedYield/100)),
    };
    setLocalYield({ predictedYield, etaBins, critCount, warnCount, totalEta, wafersIn });
  }

  useEffect(() => { computeYield(); }, [vals, wafersIn]);

  async function getAIAnalysis() {
    setLoading(true); setResult("");
    try {
      const res = await callClaude(
        `You are a TOPCon solar cell yield analysis expert. Analyze yield data and provide manufacturing insights. Be concise and specific with percentages and wafer counts.`,
        `Recipe state: Eta=${localYield?.totalEta.toFixed(2)}%, Critical alerts: ${localYield?.critCount}, Warnings: ${localYield?.warnCount}
Predicted yield: ${localYield?.predictedYield.toFixed(1)}%
Wafer input: ${wafersIn} pcs
Bin distribution: ${JSON.stringify(localYield?.etaBins)}

Provide: 1) Yield loss root causes 2) Which bins to improve 3) Top 2 recipe changes to boost yield 4) Expected yield after fix`,
        600
      );
      setResult(res);
    } catch(e) { setResult("API error."); }
    setLoading(false);
  }

  const y = localYield;
  return (
    <div style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch", padding:"14px 14px 24px" }}>
      <div style={{ background:C.surf, border:`1px solid ${C.bdr}`, borderRadius:12, padding:14, marginBottom:14 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
          <div style={{ width:36, height:36, borderRadius:10, background:`linear-gradient(135deg,${C.green},#059669)`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20 }}>📈</div>
          <div>
            <div style={{ ...raj, fontSize:16, fontWeight:700, color:C.green, letterSpacing:2 }}>YIELD PREDICTOR</div>
            <div style={{ fontSize:10, color:C.muted }}>AI-Enhanced · Real-time Physics Model</div>
          </div>
        </div>

        <div style={{ marginBottom:12 }}>
          <div style={{ ...raj, fontSize:10, color:C.muted, letterSpacing:2, marginBottom:5 }}>WAFER INPUT (PCS)</div>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <button onClick={()=>setWafersIn(Math.max(100,wafersIn-1000))}
              style={{ width:36,height:36,borderRadius:8,border:`1px solid ${C.bdr}`,background:C.panel,color:C.accent,fontSize:18,cursor:"pointer" }}>−</button>
            <div style={{ ...mono,fontSize:22,color:C.text,flex:1,textAlign:"center" }}>{wafersIn.toLocaleString()}</div>
            <button onClick={()=>setWafersIn(wafersIn+1000)}
              style={{ width:36,height:36,borderRadius:8,border:`1px solid ${C.bdr}`,background:C.panel,color:C.accent,fontSize:18,cursor:"pointer" }}>+</button>
          </div>
        </div>
      </div>

      {y && <>
        {/* Yield gauge */}
        <div style={{ background:`${y.predictedYield>=98?C.green:y.predictedYield>=95?C.amber:C.red}15`, border:`1px solid ${y.predictedYield>=98?C.green:y.predictedYield>=95?C.amber:C.red}44`, borderRadius:12, padding:16, textAlign:"center", marginBottom:14 }}>
          <div style={{ ...raj,fontSize:10,color:C.muted,letterSpacing:3,textTransform:"uppercase",marginBottom:4 }}>PREDICTED YIELD</div>
          <div style={{ ...mono,fontSize:48,fontWeight:700,color:y.predictedYield>=98?C.green:y.predictedYield>=95?C.amber:C.red,lineHeight:1 }}>{y.predictedYield.toFixed(1)}%</div>
          <div style={{ ...raj,fontSize:12,color:C.muted,marginTop:4 }}>{Math.round(y.wafersIn*(y.predictedYield/100)).toLocaleString()} / {y.wafersIn.toLocaleString()} wafers pass</div>
          <div style={{ display:"flex",justifyContent:"center",gap:12,marginTop:10 }}>
            <Chip color={C.red} small>{y.critCount} Critical</Chip>
            <Chip color={C.amber} small>{y.warnCount} Warnings</Chip>
            <Chip color={C.accent} small>Eta {y.totalEta.toFixed(2)}%</Chip>
          </div>
        </div>

        {/* Bin distribution */}
        <Divider label="Efficiency Bin Distribution"/>
        {Object.entries(y.etaBins).map(([bin,count])=>{
          const pct=((count/y.wafersIn)*100);
          const isScrap=bin.includes("scrap");
          const col=isScrap?C.red:bin.includes("≥25")?C.green:C.accent;
          return(
            <div key={bin} style={{ marginBottom:8 }}>
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3 }}>
                <span style={{ ...raj,fontSize:11,fontWeight:600,color:col }}>{bin}</span>
                <span style={{ ...mono,fontSize:12,color:col }}>{count.toLocaleString()} pcs ({pct.toFixed(1)}%)</span>
              </div>
              <div style={{ height:8,background:C.bdr,borderRadius:4,overflow:"hidden" }}>
                <div style={{ height:"100%",width:`${Math.min(100,pct)}%`,background:col,borderRadius:4,transition:"width 0.6s" }}/>
              </div>
            </div>
          );
        })}

        <button onClick={getAIAnalysis} disabled={loading}
          style={{ width:"100%",padding:"13px",borderRadius:10,border:"none",cursor:"pointer",marginTop:14,
            background:loading?C.panel:`linear-gradient(135deg,#059669,${C.green})`,
            color:loading?C.muted:"#000",...raj,fontWeight:700,fontSize:14,letterSpacing:2 }}>
          {loading?"ANALYZING...":"✦ AI YIELD ANALYSIS"}
        </button>
        {loading && <Loader text="AI analyzing yield patterns..."/>}
        {result && <AiResponse text={result}/>}
      </>}
    </div>
  );
}

// ─── VIRTUAL DOE ──────────────────────────────────────────────────────────────
function VirtualDOE({ vals }) {
  const [step, setStep] = useState(0);
  const [param, setParam] = useState(0);
  const [levels, setLevels] = useState(3);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState("");
  const [doeResults, setDoeResults] = useState(null);

  const selStep = STEPS[step];
  const selParam = selStep.params[param];

  function runDOE() {
    const p = selParam;
    const range = p.max - p.min;
    const start = Math.max(p.min, p.target - range*0.2);
    const end = Math.min(p.max, p.target + range*0.2);
    const points = Array.from({length:levels},(_,i)=>start+(end-start)*i/(levels-1));
    const results = points.map(v=>{
      const testVals = { ...vals, [selStep.key]:{ ...vals[selStep.key], [p.key]:parseFloat(v.toFixed(2)) }};
      const e = selStep.elec(testVals[selStep.key]);
      const tot = BASELINE.Eta + getAllElec(testVals).reduce((s,ee)=>s+(ee.Eta?.d??0),0);
      return { v:parseFloat(v.toFixed(2)), Eta:parseFloat(tot.toFixed(3)), Voc:parseFloat((BASELINE.Voc+(e.Voc?.d??0)).toFixed(1)), FF:parseFloat((BASELINE.FF+(e.FF?.d??0)).toFixed(2)), Rs:parseFloat((BASELINE.Rs+(e.Rs?.d??0)).toFixed(3)) };
    });
    const best = results.reduce((a,b)=>b.Eta>a.Eta?b:a);
    setDoeResults({ points:results, best, param:p, step:selStep });
  }

  useEffect(()=>{ setDoeResults(null); setResult(""); },[step,param,levels]);

  async function getAIInsight() {
    setLoading(true); setResult("");
    try {
      const res = await callClaude(
        `You are a DOE (Design of Experiments) expert for TOPCon solar cell manufacturing. Analyze DOE results and give actionable insights.`,
        `DOE Results for ${selStep.label} - ${selParam.label}:
${JSON.stringify(doeResults?.points,null,2)}
Best point: ${selParam.label}=${doeResults?.best.v}${selParam.unit} → Eta=${doeResults?.best.Eta}%

Provide: 1) Optimal operating window 2) Response curve shape 3) Interaction risks 4) Recommended setpoint with tolerance`,
        600
      );
      setResult(res);
    } catch(e) { setResult("API error."); }
    setLoading(false);
  }

  const etaMin = doeResults ? Math.min(...doeResults.points.map(p=>p.Eta)) : 24;
  const etaMax = doeResults ? Math.max(...doeResults.points.map(p=>p.Eta)) : 25;

  return (
    <div style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch", padding:"14px 14px 24px" }}>
      <div style={{ background:C.surf, border:`1px solid ${C.bdr}`, borderRadius:12, padding:14, marginBottom:14 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
          <div style={{ width:36, height:36, borderRadius:10, background:`linear-gradient(135deg,${C.purple},#7C3AED)`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20 }}>🔬</div>
          <div>
            <div style={{ ...raj, fontSize:16, fontWeight:700, color:C.purple, letterSpacing:2 }}>VIRTUAL DOE</div>
            <div style={{ fontSize:10, color:C.muted }}>Design of Experiments · Simulation Engine</div>
          </div>
        </div>

        {/* Step select */}
        <div style={{ marginBottom:10 }}>
          <div style={{ ...raj,fontSize:10,color:C.muted,letterSpacing:2,marginBottom:5 }}>PROCESS STEP</div>
          <div style={{ display:"flex",gap:6,flexWrap:"wrap" }}>
            {STEPS.map((s,i)=>(
              <button key={s.key} onClick={()=>{setStep(i);setParam(0);}}
                style={{ padding:"6px 10px",borderRadius:8,border:`1px solid ${i===step?s.color:C.bdr}`,
                  background:i===step?`${s.color}22`:C.panel,color:i===step?s.color:C.muted,
                  cursor:"pointer",...raj,fontSize:10,fontWeight:600,letterSpacing:1 }}>
                {s.short}
              </button>
            ))}
          </div>
        </div>

        {/* Param select */}
        <div style={{ marginBottom:10 }}>
          <div style={{ ...raj,fontSize:10,color:C.muted,letterSpacing:2,marginBottom:5 }}>PARAMETER TO SWEEP</div>
          <div style={{ display:"flex",gap:6,flexWrap:"wrap" }}>
            {selStep.params.map((p,i)=>(
              <button key={p.key} onClick={()=>setParam(i)}
                style={{ padding:"6px 10px",borderRadius:8,border:`1px solid ${i===param?C.accent:C.bdr}`,
                  background:i===param?`${C.accent}22`:C.panel,color:i===param?C.accent:C.muted,
                  cursor:"pointer",...raj,fontSize:10,fontWeight:600 }}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Levels */}
        <div style={{ marginBottom:14 }}>
          <div style={{ ...raj,fontSize:10,color:C.muted,letterSpacing:2,marginBottom:5 }}>NUMBER OF LEVELS: {levels}</div>
          <input type="range" min={3} max={9} step={2} value={levels} onChange={e=>setLevels(parseInt(e.target.value))}
            style={{ WebkitAppearance:"none",appearance:"none",width:"100%",height:5,borderRadius:3,outline:"none",cursor:"pointer",
              background:`linear-gradient(to right,${C.purple} ${((levels-3)/6*100)}%,${C.bdr} ${((levels-3)/6*100)}%)` }}/>
        </div>

        <button onClick={runDOE}
          style={{ width:"100%",padding:"13px",borderRadius:10,border:"none",cursor:"pointer",
            background:`linear-gradient(135deg,#7C3AED,${C.purple})`,
            color:"#fff",...raj,fontWeight:700,fontSize:14,letterSpacing:2 }}>
          ▶ RUN DOE SIMULATION
        </button>
      </div>

      {doeResults && <>
        <Divider label={`DOE Results: ${selStep.label} · ${selParam.label}`}/>

        {/* Results table */}
        <div style={{ background:C.surf,border:`1px solid ${C.bdr}`,borderRadius:12,overflow:"hidden",marginBottom:12 }}>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr 1fr",background:C.panel }}>
            {[selParam.label,"Eta %","Voc mV","FF %","Rs mΩ"].map(h=>(
              <div key={h} style={{ ...raj,fontSize:9,color:C.muted,letterSpacing:1,padding:"8px 6px",textAlign:"center",borderBottom:`1px solid ${C.bdr}` }}>{h}</div>
            ))}
          </div>
          {doeResults.points.map((pt,i)=>{
            const isBest=pt.v===doeResults.best.v;
            const etaPct=etaMax>etaMin?(pt.Eta-etaMin)/(etaMax-etaMin):0.5;
            return(
              <div key={i} style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr 1fr",background:isBest?`${C.green}11`:i%2===0?C.surf:C.bg,borderBottom:`1px solid ${C.grid}`,border:isBest?`1px solid ${C.green}44`:"" }}>
                <div style={{ ...mono,fontSize:11,padding:"8px 6px",textAlign:"center",color:isBest?C.gold:C.accent }}>{pt.v}{selParam.unit}{isBest?" ★":""}</div>
                <div style={{ ...mono,fontSize:11,padding:"8px 6px",textAlign:"center",color:isBest?C.green:C.text }}>{pt.Eta}</div>
                <div style={{ ...mono,fontSize:10,padding:"8px 6px",textAlign:"center",color:C.muted }}>{pt.Voc}</div>
                <div style={{ ...mono,fontSize:10,padding:"8px 6px",textAlign:"center",color:C.muted }}>{pt.FF}</div>
                <div style={{ ...mono,fontSize:10,padding:"8px 6px",textAlign:"center",color:C.muted }}>{pt.Rs}</div>
              </div>
            );
          })}
        </div>

        {/* Best point */}
        <div style={{ background:`${C.green}11`,border:`1px solid ${C.green}44`,borderRadius:12,padding:14,marginBottom:12 }}>
          <div style={{ ...raj,fontSize:11,color:C.green,fontWeight:700,letterSpacing:2,marginBottom:6 }}>★ OPTIMAL SETPOINT</div>
          <div style={{ ...mono,fontSize:22,color:C.green,fontWeight:700 }}>{selParam.label} = {doeResults.best.v} {selParam.unit}</div>
          <div style={{ ...mono,fontSize:13,color:C.muted,marginTop:4 }}>→ Eta {doeResults.best.Eta}% · Voc {doeResults.best.Voc}mV · FF {doeResults.best.FF}%</div>
        </div>

        <button onClick={getAIInsight} disabled={loading}
          style={{ width:"100%",padding:"13px",borderRadius:10,border:"none",cursor:"pointer",
            background:loading?C.panel:`linear-gradient(135deg,#7C3AED,${C.purple})`,
            color:loading?C.muted:"#fff",...raj,fontWeight:700,fontSize:14,letterSpacing:2 }}>
          {loading?"ANALYZING...":"✦ AI DOE INSIGHT"}
        </button>
        {loading&&<Loader text="AI analyzing DOE response surface..."/>}
        {result&&<AiResponse text={result}/>}
      </>}
    </div>
  );
}

// ─── WHAT-IF SIMULATION ───────────────────────────────────────────────────────
function WhatIfSimulation({ vals }) {
  const [scenarios, setScenarios] = useState([
    { id:1, name:"Optimal Recipe", vals:JSON.parse(JSON.stringify(vals)) },
  ]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState("");
  const [editing, setEditing] = useState(null);

  function addScenario() {
    const id = Date.now();
    setScenarios(s=>[...s,{ id, name:`Scenario ${s.length+1}`, vals:JSON.parse(JSON.stringify(vals)) }]);
  }
  function removeScenario(id) { setScenarios(s=>s.filter(x=>x.id!==id)); }
  function updateScenarioParam(id,stepKey,pk,v) {
    setScenarios(s=>s.map(sc=>sc.id!==id?sc:{...sc,vals:{...sc.vals,[stepKey]:{...sc.vals[stepKey],[pk]:v}}}));
  }

  async function compareWithAI() {
    setLoading(true); setResult("");
    const data = scenarios.map(sc=>({
      name:sc.name,
      eta:getTotalEta(sc.vals).toFixed(2),
      params:STEPS.map(s=>({step:s.label,...s.params.reduce((o,p)=>({...o,[p.label]:sc.vals[s.key][p.key]}),{})}))
    }));
    try {
      const res = await callClaude(
        `You are an expert TOPCon process engineer comparing multiple recipe scenarios. Be specific and decisive about which is best and why.`,
        `Compare these TOPCon process scenarios:\n${JSON.stringify(data,null,2)}\n\nProvide: 1) Best scenario and why 2) Key differences driving performance 3) Risks of each 4) Recommended hybrid approach`,
        700
      );
      setResult(res);
    } catch(e) { setResult("API error."); }
    setLoading(false);
  }

  const selSc = editing ? scenarios.find(s=>s.id===editing) : null;

  return (
    <div style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch", padding:"14px 14px 24px" }}>
      {!editing ? (<>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
          <div style={{ width:36,height:36,borderRadius:10,background:`linear-gradient(135deg,${C.gold},#D97706)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20 }}>⚡</div>
          <div>
            <div style={{ ...raj,fontSize:16,fontWeight:700,color:C.gold,letterSpacing:2 }}>WHAT-IF SIMULATION</div>
            <div style={{ fontSize:10,color:C.muted }}>Multi-Scenario Recipe Comparison</div>
          </div>
        </div>

        {/* Scenario cards */}
        {scenarios.map((sc,i)=>{
          const eta=getTotalEta(sc.vals);
          const d=eta-BASELINE.Eta;
          const col=eta>=24.5?C.green:eta>=24.0?C.amber:C.red;
          return(
            <div key={sc.id} style={{ background:C.surf,border:`1px solid ${C.bdr}`,borderRadius:12,padding:14,marginBottom:10 }}>
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10 }}>
                <div>
                  <div style={{ ...raj,fontSize:14,fontWeight:700,color:C.text }}>{sc.name}</div>
                  <div style={{ ...mono,fontSize:11,color:C.muted,marginTop:2 }}>Eta {eta.toFixed(2)}% · {d>=0?"+":""}{d.toFixed(2)}% vs baseline</div>
                </div>
                <div style={{ ...mono,fontSize:28,fontWeight:700,color:col }}>{eta.toFixed(2)}%</div>
              </div>
              {/* Mini bar chart */}
              {STEPS.map(s=>{
                const e=s.elec(sc.vals[s.key]);
                const d2=e.Eta?.d??0;
                return(
                  <div key={s.key} style={{ display:"flex",alignItems:"center",gap:6,marginBottom:3 }}>
                    <div style={{ width:3,height:12,borderRadius:2,background:s.color,flexShrink:0 }}/>
                    <span style={{ ...raj,fontSize:9,color:C.muted,width:60 }}>{s.short}</span>
                    <div style={{ flex:1,height:4,background:C.bdr,borderRadius:2,overflow:"hidden" }}>
                      {d2!==0&&<div style={{ height:"100%",width:`${Math.min(100,Math.abs(d2)*20)}%`,background:d2>0?C.green:C.red,borderRadius:2 }}/>}
                    </div>
                    <span style={{ ...mono,fontSize:9,color:d2>0?C.green:d2<0?C.red:C.muted,width:40,textAlign:"right" }}>{d2>=0?"+":""}{d2.toFixed(2)}%</span>
                  </div>
                );
              })}
              <div style={{ display:"flex",gap:8,marginTop:10 }}>
                <button onClick={()=>setEditing(sc.id)} style={{ flex:1,padding:"8px",borderRadius:8,border:`1px solid ${C.bdr}`,background:C.panel,color:C.accent,cursor:"pointer",...raj,fontWeight:600,fontSize:12 }}>✎ Edit Params</button>
                {scenarios.length>1&&<button onClick={()=>removeScenario(sc.id)} style={{ padding:"8px 12px",borderRadius:8,border:`1px solid ${C.red}33`,background:`${C.red}11`,color:C.red,cursor:"pointer",...raj,fontWeight:600,fontSize:12 }}>✕</button>}
              </div>
            </div>
          );
        })}

        <button onClick={addScenario} style={{ width:"100%",padding:"12px",borderRadius:10,border:`2px dashed ${C.bdr}`,background:"transparent",color:C.muted,cursor:"pointer",...raj,fontWeight:600,fontSize:13,letterSpacing:1,marginBottom:12 }}>+ ADD SCENARIO</button>

        {scenarios.length>=2&&<button onClick={compareWithAI} disabled={loading} style={{ width:"100%",padding:"13px",borderRadius:10,border:"none",cursor:"pointer",background:loading?C.panel:`linear-gradient(135deg,#D97706,${C.gold})`,color:loading?C.muted:"#000",...raj,fontWeight:700,fontSize:14,letterSpacing:2 }}>{loading?"COMPARING...":"✦ AI COMPARE SCENARIOS"}</button>}
        {loading&&<Loader text="AI comparing scenarios..."/>}
        {result&&<AiResponse text={result}/>}
      </>) : (<>
        <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:14 }}>
          <button onClick={()=>setEditing(null)} style={{ width:36,height:36,borderRadius:8,border:`1px solid ${C.bdr}`,background:C.panel,color:C.accent,cursor:"pointer",fontSize:18 }}>←</button>
          <div style={{ ...raj,fontSize:15,fontWeight:700,color:C.text }}>Edit: {selSc?.name}</div>
        </div>
        {STEPS.map(s=>(
          <div key={s.key} style={{ background:C.surf,border:`1px solid ${C.bdr}`,borderRadius:10,padding:12,marginBottom:10 }}>
            <div style={{ ...raj,fontSize:12,fontWeight:700,color:s.color,letterSpacing:1,marginBottom:8 }}>{s.label}</div>
            {s.params.map(p=>{
              const v=selSc?.vals[s.key][p.key]??p.def;
              return(
                <div key={p.key} style={{ marginBottom:10 }}>
                  <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4 }}>
                    <span style={{ fontSize:12,color:C.muted }}>{p.label}</span>
                    <div style={{ display:"flex",alignItems:"center",gap:4 }}>
                      <button onClick={()=>updateScenarioParam(editing,s.key,p.key,Math.max(p.min,v-p.step))} style={{ width:24,height:24,borderRadius:5,border:`1px solid ${C.bdr}`,background:C.panel,color:C.accent,fontSize:14,cursor:"pointer" }}>−</button>
                      <span style={{ ...mono,fontSize:12,color:C.accent,minWidth:60,textAlign:"center" }}>{v} {p.unit}</span>
                      <button onClick={()=>updateScenarioParam(editing,s.key,p.key,Math.min(p.max,v+p.step))} style={{ width:24,height:24,borderRadius:5,border:`1px solid ${C.bdr}`,background:C.panel,color:C.accent,fontSize:14,cursor:"pointer" }}>+</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
        <button onClick={()=>setEditing(null)} style={{ width:"100%",padding:"13px",borderRadius:10,border:"none",cursor:"pointer",background:`linear-gradient(135deg,#D97706,${C.gold})`,color:"#000",...raj,fontWeight:700,fontSize:14,letterSpacing:2 }}>✓ SAVE SCENARIO</button>
      </>)}
    </div>
  );
}

// ─── ROOT CAUSE ENGINE ─────────────────────────────────────────────────────────
function RootCauseEngine({ vals }) {
  const [symptom, setSymptom] = useState("");
  const [measVoc, setMeasVoc] = useState("");
  const [measFF, setMeasFF] = useState("");
  const [measEta, setMeasEta] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState("");

  const allAlerts = STEPS.flatMap(s=>s.propagate(vals[s.key]).alerts.map(a=>({...a,step:s.label})));
  const allElec = getAllElec(vals);
  const totalEta = getTotalEta(vals);

  async function diagnose() {
    setLoading(true); setResult("");
    const processState = STEPS.map((s,i)=>{
      const e=allElec[i];
      return `${s.label}: ${s.params.map(p=>`${p.label}=${vals[s.key][p.key]}${p.unit}`).join(", ")} | Eta impact: ${(e.Eta?.d??0).toFixed(2)}%`;
    }).join("\n");
    const alerts = allAlerts.map(a=>`[${a.lvl}] ${a.step}: ${a.msg}`).join("\n") || "None";
    try {
      const res = await callClaude(
        `You are an expert TOPCon solar cell failure analyst. You diagnose process problems from symptoms and recipe data. Give decisive, specific root cause analysis like a senior process engineer would.`,
        `SYMPTOM REPORTED: ${symptom || "See measured values below"}
MEASURED VALUES: Voc=${measVoc||"?"}mV, FF=${measFF||"?"}%, Eta=${measEta||"?"}%
EXPECTED: Voc=720mV, FF=83.2%, Eta=24.5%

CURRENT RECIPE STATE:
${processState}

ACTIVE ALERTS:
${alerts}

Provide EXACTLY:
1. ROOT CAUSE (most likely, single specific cause)
2. SECONDARY CAUSES (2 possibilities)  
3. EVIDENCE (which data points to this)
4. CORRECTIVE ACTION (specific parameter changes with exact values)
5. VERIFICATION (how to confirm fix worked)`,
        800
      );
      setResult(res);
    } catch(e) { setResult("API error."); }
    setLoading(false);
  }

  return (
    <div style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch", padding:"14px 14px 24px" }}>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
        <div style={{ width:36,height:36,borderRadius:10,background:`linear-gradient(135deg,${C.red},#DC2626)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20 }}>🔍</div>
        <div>
          <div style={{ ...raj,fontSize:16,fontWeight:700,color:C.red,letterSpacing:2 }}>ROOT CAUSE ENGINE</div>
          <div style={{ fontSize:10,color:C.muted }}>AI Failure Analysis · Process Diagnostics</div>
        </div>
      </div>

      {/* Auto-detected issues */}
      {allAlerts.length>0&&(<>
        <Divider label="Auto-Detected Issues"/>
        {allAlerts.slice(0,5).map((a,i)=><AlertBox key={i} {...a}/>)}
      </>)}

      {/* Manual input */}
      <Divider label="Describe the Problem"/>
      <div style={{ background:C.surf,border:`1px solid ${C.bdr}`,borderRadius:12,padding:14,marginBottom:12 }}>
        <div style={{ marginBottom:10 }}>
          <div style={{ ...raj,fontSize:10,color:C.muted,letterSpacing:2,marginBottom:5 }}>OBSERVED SYMPTOM</div>
          <textarea value={symptom} onChange={e=>setSymptom(e.target.value)} rows={3}
            placeholder="e.g. FF dropped from 83% to 79% after recipe change. EL shows dark regions on rear..."
            style={{ width:"100%",background:C.panel,border:`1px solid ${C.bdr}`,borderRadius:8,padding:"10px 12px",color:C.text,fontSize:12,outline:"none",resize:"none",lineHeight:1.5,fontFamily:"'Exo 2',sans-serif" }}/>
        </div>

        <div style={{ ...raj,fontSize:10,color:C.muted,letterSpacing:2,marginBottom:8 }}>MEASURED VALUES (optional)</div>
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:14 }}>
          {[["Voc (mV)",measVoc,setMeasVoc,"720"],["FF (%)",measFF,setMeasFF,"83.2"],["Eta (%)",measEta,setMeasEta,"24.5"]].map(([lbl,v,sv,ph])=>(
            <div key={lbl}>
              <div style={{ ...raj,fontSize:9,color:C.muted,letterSpacing:1,marginBottom:4 }}>{lbl}</div>
              <input value={v} onChange={e=>sv(e.target.value)} placeholder={ph}
                style={{ width:"100%",background:C.panel,border:`1px solid ${C.bdr}`,borderRadius:8,padding:"8px",color:C.accent,...mono,fontSize:13,outline:"none",textAlign:"center" }}/>
            </div>
          ))}
        </div>

        <button onClick={diagnose} disabled={loading}
          style={{ width:"100%",padding:"13px",borderRadius:10,border:"none",cursor:"pointer",
            background:loading?C.panel:`linear-gradient(135deg,#DC2626,${C.red})`,
            color:loading?C.muted:"#fff",...raj,fontWeight:700,fontSize:14,letterSpacing:2 }}>
          {loading?"DIAGNOSING...":"🔍 RUN ROOT CAUSE ANALYSIS"}
        </button>
      </div>

      {/* Current step impacts */}
      <Divider label="Step-by-Step Eta Impact"/>
      {STEPS.map((s,i)=>{
        const d=allElec[i].Eta?.d??0;
        const col=d>0?C.green:d<0?C.red:C.muted;
        return(
          <div key={s.key} style={{ display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:`1px solid ${C.grid}` }}>
            <div style={{ width:3,height:28,borderRadius:2,background:s.color,flexShrink:0 }}/>
            <div style={{ flex:1 }}>
              <div style={{ ...raj,fontSize:12,fontWeight:600 }}>{s.label}</div>
              <div style={{ fontSize:10,color:C.muted }}>{s.params.slice(0,2).map(p=>`${p.label}: ${vals[s.key][p.key]}${p.unit}`).join(" · ")}</div>
            </div>
            <div style={{ ...mono,fontSize:13,fontWeight:700,color:col }}>{d>=0?"+":""}{d.toFixed(2)}%</div>
          </div>
        );
      })}

      {loading&&<Loader text="AI running failure analysis..."/>}
      {result&&<AiResponse text={result}/>}
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [vals, setVals] = useState(initVals);
  const [tab, setTab] = useState("calc");
  const totalEta = getTotalEta(vals);
  const etaC = totalEta>=24.5?C.green:totalEta>=24.0?C.amber:C.red;

  const TABS = [
    { key:"calc",      icon:"⚙",  label:"Calc",     color:C.accent  },
    { key:"ai",        icon:"✦",  label:"AI Opt",   color:C.purple  },
    { key:"yield",     icon:"📈", label:"Yield",    color:C.green   },
    { key:"doe",       icon:"🔬", label:"DOE",      color:"#A855F7" },
    { key:"whatif",    icon:"⚡", label:"What-If",  color:C.gold    },
    { key:"rootcause", icon:"🔍", label:"RCA",      color:C.red     },
  ];

  return (
    <div style={{ height:"100vh", display:"flex", flexDirection:"column",
      background:C.bg, color:C.text,
      fontFamily:"'Exo 2',sans-serif", maxWidth:430, margin:"0 auto",
      overflow:"hidden" }}>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&family=Share+Tech+Mono&family=Exo+2:wght@300;400;600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;}
        input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:22px;height:22px;border-radius:50%;background:${C.accent};border:2px solid ${C.bg};box-shadow:0 0 8px ${C.accent}66;}
        ::-webkit-scrollbar{width:3px;}::-webkit-scrollbar-track{background:${C.bg};}::-webkit-scrollbar-thumb{background:${C.bdr};border-radius:2px;}
        textarea::placeholder,input::placeholder{color:${C.muted};}
      `}</style>

      {/* ── Header ── */}
      <div style={{ background:`linear-gradient(180deg,#05101F,${C.surf})`,
        borderBottom:`1px solid ${C.bdr}`, padding:"10px 16px",
        display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:36, height:36, borderRadius:9, fontSize:19,
            background:`linear-gradient(135deg,${C.accdim},${C.accent})`,
            display:"flex", alignItems:"center", justifyContent:"center",
            boxShadow:`0 0 16px ${C.accent}44` }}>☀</div>
          <div>
            <div style={{ ...raj, fontSize:17, fontWeight:700, letterSpacing:2.5, color:C.accent, lineHeight:1 }}>TOPCon AI</div>
            <div style={{ ...raj, fontSize:8, color:C.muted, letterSpacing:2, marginTop:1 }}>PROCESS OPTIMIZATION PLATFORM</div>
          </div>
        </div>
        <div style={{ textAlign:"right" }}>
          <div style={{ ...raj, fontSize:8, color:C.muted, letterSpacing:2 }}>LIVE ETA</div>
          <div style={{ ...raj, fontSize:24, fontWeight:700, color:etaC, lineHeight:1.1,
            fontFamily:"'Share Tech Mono',monospace" }}>{totalEta.toFixed(2)}%</div>
        </div>
      </div>

      {/* ── Module content ── */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
        {tab==="calc"      && <CalcModule vals={vals} setVals={setVals}/>}
        {tab==="ai"        && <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}><AIRecipeOptimizer vals={vals}/></div>}
        {tab==="yield"     && <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}><YieldPredictor vals={vals}/></div>}
        {tab==="doe"       && <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}><VirtualDOE vals={vals}/></div>}
        {tab==="whatif"    && <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}><WhatIfSimulation vals={vals}/></div>}
        {tab==="rootcause" && <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}><RootCauseEngine vals={vals}/></div>}
      </div>

      {/* ── Bottom tab bar ── */}
      <div style={{ display:"flex", background:C.surf, borderTop:`1px solid ${C.bdr}`,
        flexShrink:0, overflowX:"auto", WebkitOverflowScrolling:"touch", scrollbarWidth:"none" }}>
        {TABS.map(t=>(
          <button key={t.key} onClick={()=>setTab(t.key)}
            style={{ flex:"0 0 auto", minWidth:56, border:"none", background:"transparent",
              cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center",
              gap:1, padding:"9px 8px 7px",
              color:tab===t.key?t.color:C.muted, transition:"color 0.15s",
              borderTop:tab===t.key?`2px solid ${t.color}`:"2px solid transparent" }}>
            <span style={{ fontSize:18, lineHeight:1 }}>{t.icon}</span>
            <span style={{ ...raj, fontSize:8, letterSpacing:0.8, fontWeight:700,
              textTransform:"uppercase", whiteSpace:"nowrap" }}>{t.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
