'use client'

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'

const SCANNER_HTML = (sessionCode: string) => `<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<script src="https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js"></script>
<style>
body{margin:0;padding:8px;font-family:sans-serif;background:#0e1117;color:#fff}
#reader{width:100%;border-radius:10px;overflow:hidden}
#status{margin-top:10px;font-size:15px;color:#aaa;text-align:center;min-height:22px}
#cam-wrap{margin-bottom:8px;display:none}
#cam-wrap label{font-size:13px;color:#aaa;display:block;margin-bottom:4px}
#cam-sel{width:100%;padding:6px 8px;background:#1a1f2e;color:#fff;border:1px solid #444;border-radius:6px;font-size:14px}
</style></head><body>
<div id="cam-wrap"><label>Camera:</label>
  <select id="cam-sel" onchange="switchCam()"></select></div>
<div id="reader"></div>
<div id="status">Starting camera...</div>
<script>
var html5QrCode=new Html5Qrcode("reader"),lastScan="",cameras=[],scanning=false;
var cfg={fps:10,qrbox:{width:260,height:110}};
var SESSION="${sessionCode}";
function onScan(t){
  if(t===lastScan)return;
  lastScan=t;
  document.getElementById("status").textContent="Scanned: "+t;
  window.parent.postMessage({type:"isbn-scanned",isbn:t,session:SESSION},"*");
}
function startCam(id){
  var p=id?html5QrCode.start(id,cfg,onScan,function(){})
          :html5QrCode.start({facingMode:"environment"},cfg,onScan,function(){});
  p.then(function(){scanning=true;document.getElementById("status").textContent="Aim camera at barcode";
  }).catch(function(e){
    if(!id)html5QrCode.start({facingMode:"user"},cfg,onScan,function(){})
      .then(function(){scanning=true;document.getElementById("status").textContent="Aim camera at barcode";})
      .catch(function(e2){document.getElementById("status").textContent="Camera error: "+e2;});
    else document.getElementById("status").textContent="Camera error: "+e;
  });
}
function switchCam(){var s=document.getElementById("cam-sel").value;
  if(scanning)html5QrCode.stop().then(function(){scanning=false;startCam(s);}).catch(function(){startCam(s);});
  else startCam(s);}
Html5Qrcode.getCameras().then(function(d){cameras=d||[];
  if(cameras.length>1){
    var s=document.getElementById("cam-sel"),w=document.getElementById("cam-wrap");
    cameras.forEach(function(c,i){
      var o=document.createElement("option");o.value=c.id;
      o.textContent=c.label||("Camera "+(i+1));
      if(/back|rear|environment/i.test(c.label))o.selected=true;
      s.appendChild(o);
    });
    w.style.display="block";startCam(s.value);
  } else if(cameras.length===1)startCam(cameras[0].id);
  else startCam(null);
}).catch(function(){startCam(null);});
</script></body></html>`

export function ScannerPhonePage() {
  const searchParams = useSearchParams()
  const sessionCode = searchParams.get('session')?.trim().toUpperCase() ?? ''

  const [lastIsbn, setLastIsbn] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Listen for ISBN scanned message from the iframe
  useEffect(() => {
    async function onMessage(e: MessageEvent) {
      if (!e.data || e.data.type !== 'isbn-scanned') return
      const { isbn, session } = e.data as { isbn: string; session: string }
      setLastIsbn(isbn)
      setSent(false)
      setSendError(null)

      const res = await fetch('/api/phone-relay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_code: session, isbn }),
      })
      if (res.ok) {
        setSent(true)
        // Auto-reload after 1.5s so the scanner resets
        reloadTimer.current = setTimeout(() => {
          setSent(false)
          setLastIsbn(null)
        }, 1500)
      } else {
        const d = await res.json()
        setSendError(d.error ?? 'Failed to relay scan')
      }
    }
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
      if (reloadTimer.current) clearTimeout(reloadTimer.current)
    }
  }, [])

  if (!sessionCode) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0e1117] p-6">
        <div className="max-w-sm space-y-3 text-center">
          <p className="text-2xl">📱</p>
          <h1 className="text-lg font-bold text-white">Book Scanner</h1>
          <p className="text-sm text-gray-400">
            Open this page from your <strong className="text-white">Phone Relay</strong> QR code on
            the Page Profit desktop tab. A session code will be included automatically.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0e1117] text-white">
      <div className="px-2 pt-2 pb-1 text-center">
        <span className="text-xs text-gray-500">Session: </span>
        <span className="font-mono text-xs text-gray-300">{sessionCode}</span>
      </div>

      {sent && lastIsbn && (
        <div className="mx-2 my-2 rounded-xl border-2 border-[#00cc88] bg-[#0d3b22] px-4 py-6 text-center">
          <p className="text-4xl">✅</p>
          <p className="mt-2 text-lg font-bold text-[#00cc88]">Sent to desktop</p>
          <p className="mt-1 text-xs break-all text-gray-400">{lastIsbn}</p>
        </div>
      )}

      {sendError && (
        <p className="mx-2 my-2 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-center text-sm text-red-400">
          {sendError}
        </p>
      )}

      {!sent && (
        <iframe
          srcDoc={SCANNER_HTML(sessionCode)}
          className="h-[420px] w-full border-0"
          title="Barcode scanner"
          allow="camera"
        />
      )}

      <p className="mt-3 text-center text-xs text-gray-600">
        Scanned books appear on your desktop automatically
      </p>
    </div>
  )
}
