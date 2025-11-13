/* -------------------------
   Renderer (reusable)
   ------------------------- */
class Renderer {
    constructor(canvas){
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.dpr = window.devicePixelRatio || 1;
        this.resize();
        window.addEventListener('resize', ()=>this.resize());
    }
    resize(){
        const rect = this.canvas.getBoundingClientRect();
        this.canvas.width = Math.round(rect.width * this.dpr);
        this.canvas.height = Math.round(rect.height * this.dpr);
        this.ctx.setTransform(this.dpr,0,0,this.dpr,0,0);
        if(this.last) this.render(this.last.mem, this.last.active);
    }
    clear(){ this.ctx.clearRect(0,0,this.canvas.width,this.canvas.height); }
    render(mem, activeProcId=null){
        this.last = {mem, active:activeProcId};
        const ctx = this.ctx;
        const rect = this.canvas.getBoundingClientRect();
        const pad = 12;
        const width = rect.width - pad*2;
        const height = rect.height - pad*2;
        ctx.clearRect(0,0,rect.width,rect.height);
        ctx.save(); ctx.translate(pad,pad);
        const total = mem.size || 1;
        let x = 0;
        for(const seg of mem.segments){
            const w = Math.max(1, Math.round((seg.size/total)*width));
            if(seg.type === 'alloc'){
                const g = ctx.createLinearGradient(x,0,x+w,0); g.addColorStop(0,'#34d399'); g.addColorStop(1,'#06b6d4'); ctx.fillStyle = g;
            } else {
                const g = ctx.createLinearGradient(x,0,x+w,0); g.addColorStop(0,'#94a3b8'); g.addColorStop(1,'#475569'); ctx.fillStyle = g;
            }
            ctx.fillRect(x,0,w,height);
            ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1; ctx.strokeRect(x,0,w,height);
            ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.font = '12px monospace'; ctx.textBaseline = 'top';
            const label = seg.type === 'alloc' ? `${seg.procId} (${seg.size}KB)` : `Hole (${seg.size}KB)`;
            ctx.fillText(label, x + 6, 6);
            if(activeProcId && seg.procId === activeProcId){
                ctx.save(); ctx.strokeStyle = 'rgba(250,204,21,0.95)'; ctx.lineWidth = 3; ctx.strokeRect(x-2,0,w+4,height); ctx.restore();
            }
            x += w;
        }
        ctx.restore();
    }
}

/* -------------------------
   Partition Renderer (specialized for fixed partitions)
   ------------------------- */
class PartitionRenderer {
    constructor(canvas){
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.dpr = window.devicePixelRatio || 1;
        this.resize();
        window.addEventListener('resize', ()=>this.resize());
    }
    resize(){
        const rect = this.canvas.getBoundingClientRect();
        this.canvas.width = Math.round(rect.width * this.dpr);
        this.canvas.height = Math.round(rect.height * this.dpr);
        this.ctx.setTransform(this.dpr,0,0,this.dpr,0,0);
        if(this.last) this.render(this.last.partitions, this.last.allocations);
    }
    clear(){ this.ctx.clearRect(0,0,this.canvas.width,this.canvas.height); }
    render(partitions, allocations=[]){
        this.last = {partitions, allocations};
        const ctx = this.ctx;
        const rect = this.canvas.getBoundingClientRect();
        const pad = 12;
        const width = rect.width - pad*2;
        const height = rect.height - pad*2;
        ctx.clearRect(0,0,rect.width,rect.height);
        ctx.save(); ctx.translate(pad,pad);
        
        const totalSize = partitions.reduce((sum, p) => sum + p.size, 0);
        let x = 0;
        
        for(const part of partitions){
            const w = Math.max(1, Math.round((part.size/totalSize)*width));
            const allocation = allocations.find(a => a.partitionId === part.id);
            
            if(allocation){
                // Partition is allocated
                const g = ctx.createLinearGradient(x,0,x+w,0); 
                g.addColorStop(0,'#34d399'); g.addColorStop(1,'#06b6d4'); 
                ctx.fillStyle = g;
                ctx.fillRect(x,0,w,height);
                ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1; ctx.strokeRect(x,0,w,height);
                ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.font = '12px monospace'; ctx.textBaseline = 'top';
                ctx.fillText(`${part.id}: ${allocation.procId} (${allocation.procSize}KB/${part.size}KB)`, x + 6, 6);
                
                // Show unused space in partition
                if(allocation.procSize < part.size){
                    const unusedHeight = 8;
                    const unusedWidth = Math.max(1, Math.round((part.size - allocation.procSize)/part.size * w));
                    ctx.fillStyle = 'rgba(255,255,255,0.1)';
                    ctx.fillRect(x + w - unusedWidth, height - unusedHeight, unusedWidth, unusedHeight);
                }
            } else {
                // Partition is free
                const g = ctx.createLinearGradient(x,0,x+w,0); 
                g.addColorStop(0,'#94a3b8'); g.addColorStop(1,'#475569'); 
                ctx.fillStyle = g;
                ctx.fillRect(x,0,w,height);
                ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1; ctx.strokeRect(x,0,w,height);
                ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.font = '12px monospace'; ctx.textBaseline = 'top';
                ctx.fillText(`${part.id}: Free (${part.size}KB)`, x + 6, 6);
            }
            x += w;
        }
        ctx.restore();
    }
}

/* -------------------------
   Utilities & trace engine
   ------------------------- */
function clone(o){ return JSON.parse(JSON.stringify(o)); }
function mergeSegments(segs){
    if(!segs.length) return [];
    const sorted = segs.slice().sort((a,b)=>a.start-b.start);
    const out = [];
    for(const s of sorted){
        if(!out.length) out.push({...s});
        else{ const last = out[out.length-1]; if(last.type==='hole' && s.type==='hole' && last.start + last.size === s.start) last.size += s.size; else out.push({...s}); }
    }
    return out;
}
function normalize(memSize, segs){
    const sorted = segs.slice().sort((a,b)=>a.start-b.start);
    const out = []; let cursor = 0;
    for(const s of sorted){
        if(s.start > cursor) out.push({start:cursor, size: s.start - cursor, type: 'hole'});
        const end = Math.min(s.start + s.size, memSize);
        out.push({...s, start: s.start, size: Math.max(0, end - s.start)});
        cursor = end;
    }
    if(cursor < memSize) out.push({start:cursor, size:memSize - cursor, type:'hole'});
    return mergeSegments(out);
}
function findHoles(segs){ return segs.filter(s=>s.type === 'hole'); }

/* generateTrace: for single/comparison modes */
function generateTrace(memSize, processes, algo){
    let mem = { size: memSize, segments: [{start:0,size:memSize,type:'hole'}] };
    const procs = clone(processes).sort((a,b)=>a.arrival - b.arrival);
    const trace = [], waiting = [], finished = [];
    let t = 0;
    const push = (event, activeProc=null) => trace.push({ time: t, event, mem: clone(mem), waiting: clone(waiting), finished: clone(finished), activeProc });
    push('start', null);
    const lastArrival = procs.length ? Math.max(...procs.map(p=>p.arrival)) : 0;
    const maxTime = lastArrival + procs.length * 4 + 10;

    while(t <= maxTime){
        const arriving = procs.filter(p=>p.arrival === t);
        for(const a of arriving){
            waiting.push({...a, state:'waiting'});
            push(`arrive ${a.id}`, a.id);
        }

        let progress = true;
        while(progress){
            progress = false;
            if(!waiting.length) break;
            const holesList = findHoles(mem.segments).map(h=>({start:h.start,size:h.size,seg:h}));
            if(!holesList.length) break;

            for(let i=0;i<waiting.length;i++){
                const proc = waiting[i];
                let chosen = null;
                if(algo === 'first') {
                    chosen = holesList.find(h=>h.size >= proc.size);
                } else if(algo === 'best'){
                    chosen = holesList.reduce((best,h)=> (h.size >= proc.size && (!best || h.size < best.size))?h:best, null);
                } else if(algo === 'worst'){
                    chosen = holesList.reduce((worst,h)=> (h.size >= proc.size && (!worst || h.size > worst.size))?h:worst, null);
                }

                if(chosen){
                    const seg = chosen.seg;
                    const idx = mem.segments.indexOf(seg);
                    const alloc = { start: seg.start, size: proc.size, type:'alloc', procId: proc.id };
                    const remain = seg.size - proc.size;
                    if(remain > 0){
                        const hole = { start: seg.start + proc.size, size: remain, type:'hole' };
                        mem.segments.splice(idx,1,alloc,hole);
                    } else {
                        mem.segments.splice(idx,1,alloc);
                    }
                    mem.segments = normalize(mem.size, mem.segments);
                    waiting.splice(i,1);
                    finished.push({...proc, finishTime: t});
                    push(`allocate ${proc.id}`, proc.id);
                    progress = true;
                    break;
                }
            }
        }

        if(procs.every(p=>p.arrival <= t) && waiting.length === 0){
            push('done', null);
            break;
        }
        t++;
    }
    push('end', null);
    return trace;
}

/* generatePartitionTrace: for partition mode with fixed partitions */
function generatePartitionTrace(partitions, processes, algo){
    const trace = [];
    const allocations = []; // {partitionId, procId, procSize}
    const waiting = [];
    const finished = [];
    let t = 0;
    
    const push = (event, activeProc=null) => trace.push({ 
        time: t, event, 
        partitions: clone(partitions),
        allocations: clone(allocations),
        waiting: clone(waiting), 
        finished: clone(finished), 
        activeProc 
    });
    
    push('start', null);
    const lastArrival = processes.length ? Math.max(...processes.map(p=>p.arrival)) : 0;
    const maxTime = lastArrival + processes.length * 4 + 10;

    while(t <= maxTime){
        // Add arriving processes
        const arriving = processes.filter(p=>p.arrival === t);
        for(const a of arriving){
            waiting.push({...a, state:'waiting'});
            push(`arrive ${a.id}`, a.id);
        }

        let progress = true;
        while(progress){
            progress = false;
            if(!waiting.length) break;
            
            // Find free partitions
            const freePartitions = partitions.filter(p => 
                !allocations.some(a => a.partitionId === p.id)
            );
            
            if(!freePartitions.length) break;

            for(let i=0;i<waiting.length;i++){
                const proc = waiting[i];
                let chosenPartition = null;
                
                // Find suitable partition based on algorithm
                if(algo === 'first') {
                    chosenPartition = freePartitions.find(p => p.size >= proc.size);
                } else if(algo === 'best'){
                    chosenPartition = freePartitions.reduce((best,p)=> 
                        (p.size >= proc.size && (!best || p.size < best.size))?p:best, null);
                } else if(algo === 'worst'){
                    chosenPartition = freePartitions.reduce((worst,p)=> 
                        (p.size >= proc.size && (!worst || p.size > worst.size))?p:worst, null);
                }

                if(chosenPartition){
                    allocations.push({
                        partitionId: chosenPartition.id,
                        procId: proc.id,
                        procSize: proc.size
                    });
                    waiting.splice(i,1);
                    finished.push({...proc, finishTime: t});
                    push(`allocate ${proc.id} in ${chosenPartition.id}`, proc.id);
                    progress = true;
                    break;
                }
            }
        }

        if(processes.every(p=>p.arrival <= t) && waiting.length === 0){
            push('done', null);
            break;
        }
        t++;
    }
    push('end', null);
    return trace;
}

/* -------------------------
   App state and DOM wiring
   ------------------------- */

const canvas = document.getElementById('memCanvas');
const partitionCanvas = document.getElementById('partitionCanvas');
const renderer = new Renderer(canvas);
const partitionRenderer = new PartitionRenderer(partitionCanvas);

/* comparison renderers (created lazily) - using PartitionRenderer for comparison mode */
let rendererFF = null, rendererBF = null, rendererWF = null;

let processes = [];
let partitions = [];
let trace = [];            // single mode trace
let traceFF = [], traceBF = [], traceWF = []; // comparison traces (partition mode)
let partitionTrace = [];   // partition mode trace
let step = 0;
let playing = false;
let raf = null;
let lastTime = 0;
let playAccumulator = 0;
let playInterval = 600;

/* DOM helpers */
function $(id){ return document.getElementById(id); }
const procTableBody = document.querySelector('#procTable tbody');
const partTableBody = document.querySelector('#partTable tbody');
const logEl = $('log');

/* render tables */
function renderProcTable(){ 
    procTableBody.innerHTML = ''; 
    processes.forEach((p,i)=>{ 
        const tr = document.createElement('tr'); 
        tr.innerHTML = `<td>${p.id}</td><td>${p.size}</td><td>${p.arrival}</td><td style="text-align:right"><button data-i="${i}" class="icon-btn remove-proc">✖</button></td>`; 
        procTableBody.appendChild(tr); 
    }); 
    $('totalProc') && ($('totalProc').innerText = processes.length); 
}

function renderPartTable(){ 
    partTableBody.innerHTML = ''; 
    partitions.forEach((p,i)=>{ 
        const tr = document.createElement('tr'); 
        tr.innerHTML = `<td>${p.id}</td><td>${p.size}</td><td style="text-align:right"><button data-i="${i}" class="icon-btn remove-part">✖</button></td>`; 
        partTableBody.appendChild(tr); 
    }); 
    updatePartitionStats();
}

function updatePartitionStats(){
    const totalSize = partitions.reduce((sum, p) => sum + p.size, 0);
    const largestPart = partitions.length ? Math.max(...partitions.map(p => p.size)) : 0;
    $('totalPartSize').innerText = `${totalSize} KB`;
    $('partCount').innerText = partitions.length;
    $('largestPart').innerText = `${largestPart} KB`;
}

/* logging helper */
function addLog(txt){ 
    const t = new Date().toLocaleTimeString(); 
    logEl.innerText = `[${t}] ${txt}\n` + logEl.innerText; 
}

function addPartitionLog(txt){ 
    const t = new Date().toLocaleTimeString(); 
    $('partitionLog').innerText = `[${t}] ${txt}\n` + $('partitionLog').innerText; 
}

/* WIRE UI: tabs (single vs comparison vs partition) */
const singleTabBtn = $('tabSingle');
const compTabBtn = $('tabComparison');
const partTabBtn = $('tabPartition');
const singlePanel = $('singleModePanel');
const compPanel = $('comparisonPanel');
const partPanel = $('partitionPanel');
const defaultRightPanel = $('defaultRightPanel');
const partitionRightPanel = $('partitionRightPanel');

let currentMode = 'single'; // 'single', 'comparison', or 'partition'

function switchMode(mode){
    currentMode = mode;
    
    // Reset all tab styles
    [singleTabBtn, compTabBtn, partTabBtn].forEach(btn => {
        btn.style.background = 'transparent';
        btn.style.border = '1px solid rgba(255,255,255,0.04)';
        btn.style.color = 'var(--muted)';
    });
    
    // Hide all panels
    [singlePanel, compPanel, partPanel].forEach(panel => panel.style.display = 'none');
    [defaultRightPanel, partitionRightPanel].forEach(panel => panel.style.display = 'none');
    
    // Activate selected mode
    if(mode === 'single'){
        singleTabBtn.style.background = 'linear-gradient(90deg,var(--accent),#9b5cff)';
        singleTabBtn.style.color = 'white';
        singlePanel.style.display = 'block';
        defaultRightPanel.style.display = 'flex';
    } else if(mode === 'comparison'){
        compTabBtn.style.background = 'linear-gradient(90deg,var(--accent),#9b5cff)';
        compTabBtn.style.color = 'white';
        compPanel.style.display = 'block';
        partitionRightPanel.style.display = 'block';
        // Force resize of comparison canvases when switching to comparison mode
        setTimeout(() => {
            if(rendererFF) rendererFF.resize();
            if(rendererBF) rendererBF.resize();
            if(rendererWF) rendererWF.resize();
        }, 100);
    } else if(mode === 'partition'){
        partTabBtn.style.background = 'linear-gradient(90deg,var(--accent),#9b5cff)';
        partTabBtn.style.color = 'white';
        partPanel.style.display = 'block';
        partitionRightPanel.style.display = 'block';
        
        // Force resize of partition canvas when switching to partition mode
        setTimeout(() => {
            partitionRenderer.resize();
        }, 100);
    }
}

singleTabBtn.addEventListener('click', ()=> switchMode('single'));
compTabBtn.addEventListener('click', ()=> switchMode('comparison'));
partTabBtn.addEventListener('click', ()=> switchMode('partition'));

/* Controls */
$('addProcBtn').addEventListener('click', ()=>{
    const id = $('procId').value.trim() || `P${processes.length+1}`;
    const size = parseInt($('procSize').value) || 0;
    const arrival = parseInt($('procArrival').value) || 0;
    if(!id || size <= 0){ alert('Provide valid ID and size'); return; }
    processes.push({id, size, arrival});
    renderProcTable();
    $('summaryAlloc').innerText = `Allocations: ${processes.length}`;
});

$('addPartBtn').addEventListener('click', ()=>{
    const id = $('partId').value.trim() || `Part${partitions.length+1}`;
    const size = parseInt($('partSize').value) || 0;
    if(!id || size <= 0){ alert('Provide valid ID and size'); return; }
    partitions.push({id, size});
    renderPartTable();
    $('partId').value = '';
    $('partSize').value = '';
});

$('clearProcs').addEventListener('click', ()=>{ processes = []; renderProcTable(); $('summaryAlloc').innerText = 'Allocations: 0'; });
$('clearParts').addEventListener('click', ()=>{ partitions = []; renderPartTable(); });

procTableBody.addEventListener('click', (e)=>{ 
    if(e.target.classList.contains('remove-proc')){ 
        processes.splice(+e.target.dataset.i,1); 
        renderProcTable(); 
        $('summaryAlloc').innerText = `Allocations: ${processes.length}`; 
    } 
});

partTableBody.addEventListener('click', (e)=>{ 
    if(e.target.classList.contains('remove-part')){ 
        partitions.splice(+e.target.dataset.i,1); 
        renderPartTable(); 
    } 
});

/* Partition algorithm change */
$('partitionAlgo').addEventListener('change', ()=>{
    $('partitionAlgoLabel').innerText = $('partitionAlgo').options[$('partitionAlgo').selectedIndex].text;
});

/* Run / generate trace - branching based on currentMode */
function runGenerateTrace(){
    const memSize = parseInt($('memSize').value) || 0;
    if(memSize <= 0){ alert('Set memory size'); return; }
    if(processes.some(p=>p.size <= 0)){ alert('Ensure process sizes > 0'); return; }

    if(currentMode === 'single'){
        const algo = document.querySelector('input[name=algo]:checked').value;
        trace = generateTrace(memSize, processes, algo);
        step = 0;
        $('timeline').max = Math.max(0, trace.length - 1);
        $('timeline').value = 0;
        $('maxStep').innerText = trace.length - 1;
        $('log').innerText = '';
        addLog(`Generated trace (${trace.length} steps) using ${algo} (single mode)`);
        updateView();
        computeStats();
        showFloatingBar();
    } else if(currentMode === 'comparison'){
        if(partitions.length === 0){ alert('Add at least one partition for comparison mode'); return; }
        traceFF = generatePartitionTrace(partitions, processes, 'first');
        traceBF = generatePartitionTrace(partitions, processes, 'best');
        traceWF = generatePartitionTrace(partitions, processes, 'worst');
        step = 0;
        const maxLen = Math.max(traceFF.length, traceBF.length, traceWF.length);
        $('timelineC').max = Math.max(0, maxLen - 1);
        $('timelineC').value = 0;
        $('maxStepC').innerText = maxLen - 1;
        $('logFF').innerText = 'Comparison run started (First Fit).\n';
        $('logBF').innerText = 'Comparison run started (Best Fit).\n';
        $('logWF').innerText = 'Comparison run started (Worst Fit).\n';
        addLog(`Generated partition comparison traces — FF:${traceFF.length}, BF:${traceBF.length}, WF:${traceWF.length}`);
        if(!rendererFF){ rendererFF = new PartitionRenderer($('canvasFF')); }
        if(!rendererBF){ rendererBF = new PartitionRenderer($('canvasBF')); }
        if(!rendererWF){ rendererWF = new PartitionRenderer($('canvasWF')); }
        updateComparisonView();
        computeComparisonStats();
        showFloatingBar();
    } else if(currentMode === 'partition'){
        if(partitions.length === 0){ alert('Add at least one partition'); return; }
        const algo = $('partitionAlgo').value;
        partitionTrace = generatePartitionTrace(partitions, processes, algo);
        step = 0;
        $('timelineP').max = Math.max(0, partitionTrace.length - 1);
        $('timelineP').value = 0;
        $('maxStepP').innerText = partitionTrace.length - 1;
        $('partitionLog').innerText = '';
        addPartitionLog(`Generated partition trace (${partitionTrace.length} steps) using ${algo}`);
        updatePartitionView();
        computePartitionStats();
        showFloatingBar();
    }
}

$('runBtn').addEventListener('click', runGenerateTrace);
$('runBtnBottom').addEventListener('click', runGenerateTrace);

/* Floating controls actions */
$('playBtn').addEventListener('click', ()=>{
    if(currentMode === 'single' && !trace.length) runGenerateTrace();
    if(currentMode === 'comparison' && (!traceFF.length && !traceBF.length && !traceWF.length)) runGenerateTrace();
    if(currentMode === 'partition' && !partitionTrace.length) runGenerateTrace();
    if((currentMode === 'single' && !trace.length) || 
       (currentMode === 'comparison' && (!traceFF.length && !traceBF.length && !traceWF.length)) ||
       (currentMode === 'partition' && !partitionTrace.length)) return;
    if(playing) return;
    playing = true; lastTime = performance.now(); playAccumulator = 0;
    raf = requestAnimationFrame(playLoop);
    addLog('Playback started');
    $('statusLabel').innerText = 'Playing';
    $('statusLabelP').innerText = 'Playing';
});
$('pauseBtn').addEventListener('click', ()=>{
    if(!playing){ $('statusLabel').innerText = 'Paused'; $('statusLabelP').innerText = 'Paused'; return; }
    playing = false; if(raf){ cancelAnimationFrame(raf); raf = null; }
    addLog('Playback paused'); 
    $('statusLabel').innerText = 'Paused';
    $('statusLabelP').innerText = 'Paused';
});
$('nextBtn').addEventListener('click', ()=> stepForward());
$('prevBtn').addEventListener('click', ()=> stepBack());
$('restartBtn').addEventListener('click', ()=>{ 
    if(currentMode==='single'){ 
        if(!trace.length) return; 
        step=0; updateView(); 
    } else if(currentMode==='comparison'){ 
        if(!traceFF.length && !traceBF.length && !traceWF.length) return; 
        step=0; updateComparisonView(); 
    } else if(currentMode==='partition'){ 
        if(!partitionTrace.length) return; 
        step=0; updatePartitionView(); 
    } 
    addLog('Restarted'); 
    $('statusLabel').innerText = 'Restarted';
    $('statusLabelP').innerText = 'Restarted';
});

/* exports & clear */
$('exportPNG').addEventListener('click', ()=>{ 
    let targetCanvas = canvas;
    if(currentMode === 'partition') {
        targetCanvas = partitionCanvas;
    } else if(currentMode === 'comparison' && rendererFF) {
        // Export first fit canvas for comparison mode
        targetCanvas = $('canvasFF');
    }
    const url = targetCanvas.toDataURL('image/png'); 
    const a = document.createElement('a'); a.href = url; a.download = 'memory_alloc.png'; a.click(); 
});
$('exportTrace').addEventListener('click', ()=>{ 
    if(currentMode==='single'){ 
        if(!trace.length){ alert('No trace. Run first.'); return; } 
        const blob = new Blob([JSON.stringify(trace,null,2)],{type:'application/json'}); 
        const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = 'trace.json'; a.click(); URL.revokeObjectURL(u); 
    } else if(currentMode==='comparison'){ 
        const combined = { first: traceFF, best: traceBF, worst: traceWF }; 
        const blob = new Blob([JSON.stringify(combined,null,2)],{type:'application/json'}); 
        const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = 'comparison_trace.json'; a.click(); URL.revokeObjectURL(u); 
    } else if(currentMode==='partition'){ 
        if(!partitionTrace.length){ alert('No trace. Run first.'); return; } 
        const blob = new Blob([JSON.stringify(partitionTrace,null,2)],{type:'application/json'}); 
        const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = 'partition_trace.json'; a.click(); URL.revokeObjectURL(u); 
    } 
});
$('clearAll').addEventListener('click', ()=>{ 
    if(!confirm('Clear everything?')) return; 
    processes = []; partitions = []; 
    trace = []; traceFF = []; traceBF = []; traceWF = []; partitionTrace = []; 
    step = 0; 
    renderProcTable(); renderPartTable(); 
    updateView(); updateComparisonView(); updatePartitionView(); 
    $('log').innerText = 'No logs yet.'; 
    $('partitionLog').innerText = 'No logs yet.';
    $('summaryAlloc').innerText = 'Allocations: 0'; 
    $('statusLabel').innerText = 'Idle'; 
    $('statusLabelP').innerText = 'Idle';
    hideFloatingBar(); 
});

/* speed & timeline wiring */
$('timeline').addEventListener('input', ()=>{ step = parseInt($('timeline').value) || 0; updateView(); });
$('timelineC').addEventListener('input', ()=>{ step = parseInt($('timelineC').value) || 0; updateComparisonView(); });
$('timelineP').addEventListener('input', ()=>{ step = parseInt($('timelineP').value) || 0; updatePartitionView(); });

/* play loop */
function playLoop(now){
    if(!playing){ if(raf){ cancelAnimationFrame(raf); raf = null; } return; }
    raf = requestAnimationFrame(playLoop);
    if(!lastTime) lastTime = now;
    const dt = now - lastTime; lastTime = now;
    playAccumulator += dt;
    if(playAccumulator >= playInterval){
        playAccumulator = 0;
        if(currentMode === 'single'){
            if(step < trace.length - 1){ step++; updateView(); $('timeline').value = step; }
            else { playing = false; if(raf){ cancelAnimationFrame(raf); raf = null; } addLog('Playback finished'); $('statusLabel').innerText = 'Finished'; }
        } else if(currentMode === 'comparison'){
            const maxLen = Math.max(traceFF.length, traceBF.length, traceWF.length);
            if(step < maxLen - 1){ step++; updateComparisonView(); $('timelineC').value = step; }
            else { playing = false; if(raf){ cancelAnimationFrame(raf); raf = null; } addLog('Playback finished (partition comparison)'); $('statusLabel').innerText = 'Finished'; }
        } else if(currentMode === 'partition'){
            if(step < partitionTrace.length - 1){ step++; updatePartitionView(); $('timelineP').value = step; }
            else { playing = false; if(raf){ cancelAnimationFrame(raf); raf = null; } addPartitionLog('Playback finished'); $('statusLabelP').innerText = 'Finished'; }
        }
    }
}

/* step controls */
function stepForward(){ 
    if(currentMode === 'single'){ 
        if(trace.length && step < trace.length - 1){ step++; updateView(); $('timeline').value = step; } 
    } else if(currentMode === 'comparison'){ 
        const maxLen = Math.max(traceFF.length, traceBF.length, traceWF.length); 
        if(step < maxLen - 1){ step++; updateComparisonView(); $('timelineC').value = step; } 
    } else if(currentMode === 'partition'){ 
        if(partitionTrace.length && step < partitionTrace.length - 1){ step++; updatePartitionView(); $('timelineP').value = step; } 
    } 
}
function stepBack(){ 
    if(currentMode === 'single'){ 
        if(trace.length && step > 0){ step--; updateView(); $('timeline').value = step; } 
    } else if(currentMode === 'comparison'){ 
        if(step > 0){ step--; updateComparisonView(); $('timelineC').value = step; } 
    } else if(currentMode === 'partition'){ 
        if(partitionTrace.length && step > 0){ step--; updatePartitionView(); $('timelineP').value = step; } 
    } 
}

/* update view (single mode) */
function updateView(){
    if(!trace.length){ renderer.clear(); $('curStep').innerText = 0; $('maxStep').innerText = 0; $('util').innerText = '0%'; $('summarySteps').innerText = 'Steps: 0'; return; }
    const frame = trace[step];
    renderer.render(frame.mem, frame.activeProc);
    $('curStep').innerText = step; $('maxStep').innerText = trace.length - 1;
    $('statusLabel').innerText = frame.event;
    $('log').innerText = '';
    for(let i=0;i<=step;i++){ const f = trace[i]; $('log').innerText += `[t=${f.time}] ${f.event}\n`; }
    const used = frame.mem.segments.filter(s=>s.type==='alloc').reduce((s,v)=>s+v.size,0);
    const util = Math.round((used / frame.mem.size) * 100);
    $('util').innerText = util + '%';
    $('summarySteps').innerText = `Steps: ${trace.length}`;
    $('summaryAlloc').innerText = `Allocations: ${processes.length}`;
}

/* helper: compute partition stats */
function computePartitionStatsFromTrace(frame){
    if(!frame || !frame.partitions) return {util:0, freePartitions:0, allocatedPartitions:0, totalWaste:0};
    const allocatedSize = frame.allocations.reduce((sum, a) => sum + a.procSize, 0);
    const totalPartitionSize = frame.partitions.reduce((sum, p) => sum + p.size, 0);
    const util = totalPartitionSize ? Math.round((allocatedSize / totalPartitionSize) * 100) : 0;
    const freePartitions = frame.partitions.filter(p => !frame.allocations.some(a => a.partitionId === p.id)).length;
    const allocatedPartitions = frame.allocations.length;
    const totalWaste = frame.allocations.reduce((sum, a) => {
        const part = frame.partitions.find(p => p.id === a.partitionId);
        return sum + (part ? part.size - a.procSize : 0);
    }, 0);
    return {util, freePartitions, allocatedPartitions, totalWaste};
}

/* update comparison view */
function updateComparisonView(){
    if(rendererFF && traceFF.length) {
        const idx = Math.min(step, traceFF.length - 1);
        const fff = traceFF[idx];
        rendererFF.render(fff.partitions, fff.allocations);
        // Update log - show all events up to current step
        $('logFF').innerText = '';
        for(let i=0;i<=idx;i++){ 
            const f = traceFF[i]; 
            $('logFF').innerText += `[t=${f.time}] ${f.event}\n`; 
        }
        const s = computePartitionStatsFromTrace(fff);
        $('statFF').innerText = `Util: ${s.util}%`;
        $('fragCountFF').innerText = `Free partitions: ${s.freePartitions}`;
        $('largestFreeFF').innerText = `Allocated: ${s.allocatedPartitions}`;
        $('extFragFF').innerText = `Waste: ${s.totalWaste} KB`;
    } else if(rendererFF) { rendererFF.clear(); $('statFF').innerText = 'No alloc'; }

    if(rendererBF && traceBF.length) {
        const idx = Math.min(step, traceBF.length - 1);
        const fbf = traceBF[idx];
        rendererBF.render(fbf.partitions, fbf.allocations);
        // Update log - show all events up to current step
        $('logBF').innerText = '';
        for(let i=0;i<=idx;i++){ 
            const f = traceBF[i]; 
            $('logBF').innerText += `[t=${f.time}] ${f.event}\n`; 
        }
        const s = computePartitionStatsFromTrace(fbf);
        $('statBF').innerText = `Util: ${s.util}%`;
        $('fragCountBF').innerText = `Free partitions: ${s.freePartitions}`;
        $('largestFreeBF').innerText = `Allocated: ${s.allocatedPartitions}`;
        $('extFragBF').innerText = `Waste: ${s.totalWaste} KB`;
    } else if(rendererBF) { rendererBF.clear(); $('statBF').innerText = 'No alloc'; }

    if(rendererWF && traceWF.length) {
        const idx = Math.min(step, traceWF.length - 1);
        const fwf = traceWF[idx];
        rendererWF.render(fwf.partitions, fwf.allocations);
        // Update log - show all events up to current step
        $('logWF').innerText = '';
        for(let i=0;i<=idx;i++){ 
            const f = traceWF[i]; 
            $('logWF').innerText += `[t=${f.time}] ${f.event}\n`; 
        }
        const s = computePartitionStatsFromTrace(fwf);
        $('statWF').innerText = `Util: ${s.util}%`;
        $('fragCountWF').innerText = `Free partitions: ${s.freePartitions}`;
        $('largestFreeWF').innerText = `Allocated: ${s.allocatedPartitions}`;
        $('extFragWF').innerText = `Waste: ${s.totalWaste} KB`;
    } else if(rendererWF) { rendererWF.clear(); $('statWF').innerText = 'No alloc'; }

    const maxLen = Math.max(traceFF.length, traceBF.length, traceWF.length);
    $('curStepC').innerText = step;
    $('maxStepC').innerText = Math.max(0, maxLen - 1);
    const uFF = (traceFF.length ? computePartitionStatsFromTrace(traceFF[Math.min(step, traceFF.length-1)]).util : 0);
    const uBF = (traceBF.length ? computePartitionStatsFromTrace(traceBF[Math.min(step, traceBF.length-1)]).util : 0);
    const uWF = (traceWF.length ? computePartitionStatsFromTrace(traceWF[Math.min(step, traceWF.length-1)]).util : 0);
    const count = (traceFF.length?1:0) + (traceBF.length?1:0) + (traceWF.length?1:0);
    const avgUtil = count ? Math.round((uFF + uBF + uWF)/count) : 0;
    $('utilC').innerText = avgUtil + '%';
    $('summarySteps').innerText = `Steps: ${maxLen}`;
    $('summaryAlloc').innerText = `Allocations: ${processes.length}`;
}

/* update partition view */
function updatePartitionView(){
    if(!partitionTrace.length){ 
        partitionRenderer.clear(); 
        $('curStepP').innerText = 0; 
        $('maxStepP').innerText = 0; 
        $('utilP').innerText = '0%'; 
        $('summarySteps').innerText = 'Steps: 0'; 
        return; 
    }
    const frame = partitionTrace[step];
    partitionRenderer.render(frame.partitions, frame.allocations);
    $('curStepP').innerText = step; 
    $('maxStepP').innerText = partitionTrace.length - 1;
    $('statusLabelP').innerText = frame.event;
    $('partitionLog').innerText = '';
    for(let i=0;i<=step;i++){ const f = partitionTrace[i]; $('partitionLog').innerText += `[t=${f.time}] ${f.event}\n`; }
    
    // Calculate utilization for partition mode
    const allocatedSize = frame.allocations.reduce((sum, a) => sum + a.procSize, 0);
    const totalPartitionSize = frame.partitions.reduce((sum, p) => sum + p.size, 0);
    const util = totalPartitionSize ? Math.round((allocatedSize / totalPartitionSize) * 100) : 0;
    $('utilP').innerText = util + '%';
    $('summarySteps').innerText = `Steps: ${partitionTrace.length}`;
    $('summaryAlloc').innerText = `Allocations: ${processes.length}`;
}

/* helper: compute F3 fragmentation metrics for a memory snapshot */
function computeF3(mem){
    if(!mem || !mem.segments) return {freeBlocks:0, largestFree:0, extFrag:0, util:0};
    const holes = mem.segments.filter(s=>s.type==='hole');
    const freeBlocks = holes.length;
    const largestFree = holes.reduce((m,h)=>Math.max(m,h.size),0);
    const extFrag = holes.reduce((s,h)=>s+h.size,0);
    const used = mem.segments.filter(s=>s.type==='alloc').reduce((s,v)=>s+v.size,0);
    const util = mem.size ? Math.round((used / mem.size) * 100) : 0;
    return {freeBlocks, largestFree, extFrag, util};
}

/* compute simple stats for single mode */
function computeStats(){
    if(!trace.length){ $('avgWaiting').innerText='—'; $('avgTurn').innerText='—'; $('extFrag').innerText='—'; $('totalProc').innerText = processes.length; return; }
    const last = trace[trace.length-1]; const finished = last.finished || [];
    const avgTurn = finished.length ? Math.round(finished.reduce((s,p)=>s + ((p.finishTime||0) - (p.arrival||0)),0) / finished.length) : 0;
    const avgWait = finished.length ? Math.round(finished.reduce((s,p)=>s + Math.max(0, ((p.finishTime||0) - (p.arrival||0) - 0)),0) / finished.length) : 0;
    const frame = trace[trace.length-1];
    const frag = frame.mem.segments.filter(s=>s.type==='hole' && s.size < 32).reduce((s,h)=>s + h.size, 0);
    $('avgWaiting').innerText = avgWait + ' (approx)';
    $('avgTurn').innerText = avgTurn + 'ms';
    $('extFrag').innerText = frag + ' KB';
    $('totalProc').innerText = processes.length;
}

function computeComparisonStats(){
    // Implementation for comparison stats if needed
}

function computePartitionStats(){
    // Implementation for partition stats if needed
}

/* show/hide floating bar */
function showFloatingBar(){ const bar = $('floatingBar'); bar.classList.add('visible'); bar.setAttribute('aria-hidden','false'); }
function hideFloatingBar(){ const bar = $('floatingBar'); bar.classList.remove('visible'); bar.setAttribute('aria-hidden','true'); }

/* init demo */
renderProcTable();
// Initialize with some sample partitions
partitions = [
    {id: 'Part1', size: 300},
    {id: 'Part2', size: 200},
    {id: 'Part3', size: 400}
];
renderPartTable();

(function seed(){
    processes = [{id:'P1',size:200,arrival:0},{id:'P2',size:350,arrival:1},{id:'P3',size:100,arrival:2}];
    renderProcTable(); $('summaryAlloc').innerText = `Allocations: ${processes.length}`;
})();