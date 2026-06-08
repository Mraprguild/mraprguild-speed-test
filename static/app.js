const $ = id => document.getElementById(id);
const startButton = $("start");
const arcLength = 267;

function setGauge(value, phase, max = 100) {
  const safe = Math.max(0, Math.min(value, max));
  $("speed").textContent = Number(value).toFixed(2);
  $("phase").textContent = phase;
  $("arc").style.strokeDashoffset = String(arcLength - (safe / max) * arcLength);
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function pingTest(samples = 8) {
  const values = [];
  for (let i = 0; i < samples; i++) {
    const start = performance.now();
    const response = await fetch(`/api/ping?t=${Date.now()}-${i}`, {cache: "no-store"});
    if (!response.ok) throw new Error("Ping request failed");
    await response.json();
    values.push(performance.now() - start);
    $("status").textContent = `Ping test ${i + 1}/${samples}`;
    await sleep(80);
  }
  const sorted = [...values].sort((a,b) => a-b);
  const ping = sorted[Math.floor(sorted.length / 2)];
  const jitter = values.slice(1).reduce((sum, n, i) => sum + Math.abs(n - values[i]), 0) / (values.length - 1);
  return {ping, jitter};
}

async function downloadTest(rounds = 4, bytes = 12 * 1024 * 1024) {
  let totalBytes = 0;
  const started = performance.now();
  for (let i = 0; i < rounds; i++) {
    $("status").textContent = `Download test ${i + 1}/${rounds}`;
    const response = await fetch(`/api/download?size=${bytes}&t=${Date.now()}-${i}`, {cache: "no-store"});
    if (!response.ok) throw new Error("Download request failed");
    const reader = response.body.getReader();
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      const seconds = (performance.now() - started) / 1000;
      const mbps = totalBytes * 8 / seconds / 1_000_000;
      setGauge(mbps, "Downloading", 200);
    }
  }
  const seconds = (performance.now() - started) / 1000;
  return totalBytes * 8 / seconds / 1_000_000;
}

async function uploadTest(rounds = 3, bytes = 6 * 1024 * 1024) {
  const payload = new Uint8Array(bytes);
  crypto.getRandomValues(payload.subarray(0, Math.min(payload.length, 65536)));
  for (let i = 65536; i < payload.length; i += 65536) {
    payload.set(payload.subarray(0, Math.min(65536, payload.length - i)), i);
  }

  let totalBytes = 0;
  const started = performance.now();
  for (let i = 0; i < rounds; i++) {
    $("status").textContent = `Upload test ${i + 1}/${rounds}`;
    const response = await fetch(`/api/upload?t=${Date.now()}-${i}`, {
      method: "POST",
      headers: {"Content-Type": "application/octet-stream"},
      body: payload
    });
    if (!response.ok) throw new Error("Upload request failed");
    await response.json();
    totalBytes += bytes;
    const seconds = (performance.now() - started) / 1000;
    setGauge(totalBytes * 8 / seconds / 1_000_000, "Uploading", 100);
  }
  const seconds = (performance.now() - started) / 1000;
  return totalBytes * 8 / seconds / 1_000_000;
}

async function runTest() {
  startButton.disabled = true;
  startButton.textContent = "TESTING…";
  try {
    $("download").textContent = $("upload").textContent = $("ping").textContent = $("jitter").textContent = "--";
    setGauge(0, "Starting");
    const latency = await pingTest();
    $("ping").textContent = latency.ping.toFixed(1);
    $("jitter").textContent = latency.jitter.toFixed(1);

    const down = await downloadTest();
    $("download").textContent = down.toFixed(2);

    const up = await uploadTest();
    $("upload").textContent = up.toFixed(2);

    setGauge(down, "Complete", 200);
    $("status").textContent = "Speed test completed successfully";
  } catch (error) {
    console.error(error);
    $("phase").textContent = "Error";
    $("status").textContent = error.message || "Test failed";
  } finally {
    startButton.disabled = false;
    startButton.textContent = "TEST AGAIN";
  }
}

startButton.addEventListener("click", runTest);

fetch("/api/info", {cache:"no-store"})
  .then(r => r.json())
  .then(data => {
    $("clientIp").textContent = data.client_ip || "Unknown";
    $("serverName").textContent = data.app || "SpeedTest";
  })
  .catch(() => $("clientIp").textContent = "Unavailable");
