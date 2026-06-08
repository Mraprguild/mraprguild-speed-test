// static/app.js

const $ = (id) => document.getElementById(id);

const startButton = $("start");
const ARC_LENGTH = 267;

const CONFIG = {
    pingSamples: 12,
    pingPauseMs: 90,

    downloadDurationMs: 10000,
    uploadDurationMs: 10000,

    downloadConnections: 4,

    downloadChunkBytes: 24 * 1024 * 1024,
    uploadChunkBytes: 8 * 1024 * 1024,

    warmupMs: 1200,

    gaugeMaxDownload: 500,
    gaugeMaxUpload: 250
};


function setGauge(value, phase, maximum) {
    const speed = Number.isFinite(value) ? value : 0;

    const safeValue = Math.max(
        0,
        Math.min(speed, maximum)
    );

    $("speed").textContent = speed.toFixed(2);
    $("phase").textContent = phase;

    $("arc").style.strokeDashoffset = String(
        ARC_LENGTH -
        (safeValue / maximum) * ARC_LENGTH
    );
}


function sleep(milliseconds) {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}


function median(values) {
    const sorted = [...values].sort(
        (first, second) => first - second
    );

    const middle = Math.floor(sorted.length / 2);

    if (sorted.length % 2) {
        return sorted[middle];
    }

    return (
        sorted[middle - 1] +
        sorted[middle]
    ) / 2;
}


function trimmedMean(values, trimRatio = 0.15) {
    if (!values.length) {
        return 0;
    }

    const sorted = [...values].sort(
        (first, second) => first - second
    );

    const trimCount = Math.floor(
        sorted.length * trimRatio
    );

    const remaining = sorted.slice(
        trimCount,
        Math.max(
            trimCount + 1,
            sorted.length - trimCount
        )
    );

    const total = remaining.reduce(
        (sum, value) => sum + value,
        0
    );

    return total / remaining.length;
}


async function pingTest() {
    const samples = [];

    await fetch(
        `/api/ping?warmup=${crypto.randomUUID()}`,
        {
            cache: "no-store"
        }
    );

    for (
        let index = 0;
        index < CONFIG.pingSamples;
        index++
    ) {
        const started = performance.now();

        const response = await fetch(
            `/api/ping?t=${crypto.randomUUID()}`,
            {
                cache: "no-store"
            }
        );

        if (!response.ok) {
            throw new Error("Ping request failed");
        }

        await response.json();

        const roundTripTime =
            performance.now() - started;

        samples.push(roundTripTime);

        $("status").textContent =
            `Measuring latency ${index + 1}/${CONFIG.pingSamples}`;

        await sleep(CONFIG.pingPauseMs);
    }

    const ping = median(samples);
    const variations = [];

    for (
        let index = 1;
        index < samples.length;
        index++
    ) {
        variations.push(
            Math.abs(
                samples[index] -
                samples[index - 1]
            )
        );
    }

    return {
        ping,
        jitter: trimmedMean(variations, 0.1)
    };
}


async function downloadWorker(
    stopAt,
    onBytes
) {
    while (performance.now() < stopAt) {
        const controller =
            new AbortController();

        const remainingTime =
            stopAt - performance.now();

        const timeout = setTimeout(
            () => controller.abort(),
            Math.max(100, remainingTime)
        );

        try {
            const response = await fetch(
                `/api/download?size=${CONFIG.downloadChunkBytes}&t=${crypto.randomUUID()}`,
                {
                    cache: "no-store",
                    signal: controller.signal
                }
            );

            if (!response.ok || !response.body) {
                throw new Error(
                    "Download request failed"
                );
            }

            const reader =
                response.body.getReader();

            while (
                performance.now() < stopAt
            ) {
                const {
                    done,
                    value
                } = await reader.read();

                if (done) {
                    break;
                }

                onBytes(value.byteLength);
            }

            try {
                await reader.cancel();
            } catch (error) {
                console.debug(error);
            }
        } catch (error) {
            if (error.name !== "AbortError") {
                throw error;
            }
        } finally {
            clearTimeout(timeout);
        }
    }
}


async function downloadTest() {
    let measuredBytes = 0;

    const started = performance.now();

    const measureFrom =
        started + CONFIG.warmupMs;

    const stopAt =
        started + CONFIG.downloadDurationMs;

    const samples = [];

    const liveUpdater = setInterval(() => {
        const now = performance.now();

        if (now <= measureFrom) {
            $("status").textContent =
                "Warming up download test";

            return;
        }

        const measuredMilliseconds =
            Math.max(
                1,
                now - measureFrom
            );

        const megabitsPerSecond =
            measuredBytes *
            8 /
            measuredMilliseconds /
            1000;

        samples.push(megabitsPerSecond);

        setGauge(
            megabitsPerSecond,
            "Downloading",
            CONFIG.gaugeMaxDownload
        );

        $("status").textContent =
            `Real-time download · ${megabitsPerSecond.toFixed(2)} Mbps · ${CONFIG.downloadConnections} streams`;
    }, 200);

    const workers = Array.from(
        {
            length: CONFIG.downloadConnections
        },
        () => downloadWorker(
            stopAt,
            (bytes) => {
                if (
                    performance.now() >=
                    measureFrom
                ) {
                    measuredBytes += bytes;
                }
            }
        )
    );

    await Promise.all(workers);

    clearInterval(liveUpdater);

    const elapsedMilliseconds =
        Math.max(
            1,
            performance.now() - measureFrom
        );

    const finalSpeed =
        measuredBytes *
        8 /
        elapsedMilliseconds /
        1000;

    const recentSamples =
        samples.slice(-20);

    const stableSpeed =
        recentSamples.length
            ? trimmedMean(
                recentSamples,
                0.15
            )
            : finalSpeed;

    return (
        finalSpeed * 0.75 +
        stableSpeed * 0.25
    );
}


function createUploadPayload(size) {
    const payload =
        new Uint8Array(size);

    const randomSeed =
        new Uint8Array(64 * 1024);

    crypto.getRandomValues(randomSeed);

    for (
        let offset = 0;
        offset < payload.length;
        offset += randomSeed.length
    ) {
        const remaining =
            payload.length - offset;

        payload.set(
            randomSeed.subarray(
                0,
                Math.min(
                    randomSeed.length,
                    remaining
                )
            ),
            offset
        );
    }

    return payload;
}


function uploadOnce(
    payload,
    stopAt,
    onProgress
) {
    return new Promise(
        (resolve, reject) => {
            const request =
                new XMLHttpRequest();

            request.open(
                "POST",
                `/api/upload?t=${crypto.randomUUID()}`,
                true
            );

            request.setRequestHeader(
                "Content-Type",
                "application/octet-stream"
            );

            request.timeout = Math.max(
                1000,
                stopAt -
                performance.now() +
                1500
            );

            let previousLoaded = 0;

            request.upload.onprogress =
                (event) => {
                    const difference =
                        Math.max(
                            0,
                            event.loaded -
                            previousLoaded
                        );

                    previousLoaded =
                        event.loaded;

                    if (difference > 0) {
                        onProgress(difference);
                    }

                    if (
                        performance.now() >=
                        stopAt
                    ) {
                        request.abort();
                    }
                };

            request.onload = () => {
                if (
                    request.status >= 200 &&
                    request.status < 300
                ) {
                    resolve();
                } else {
                    reject(
                        new Error(
                            "Upload request failed"
                        )
                    );
                }
            };

            request.onerror = () => {
                reject(
                    new Error(
                        "Upload network error"
                    )
                );
            };

            request.ontimeout = () => {
                resolve();
            };

            request.onabort = () => {
                resolve();
            };

            request.send(payload);
        }
    );
}


async function uploadWorker(
    payload,
    stopAt,
    onProgress
) {
    while (performance.now() < stopAt) {
        await uploadOnce(
            payload,
            stopAt,
            onProgress
        );
    }
}


async function uploadTest() {
    const payload =
        createUploadPayload(
            CONFIG.uploadChunkBytes
        );

    let measuredBytes = 0;

    const started = performance.now();

    const measureFrom =
        started + CONFIG.warmupMs;

    const stopAt =
        started + CONFIG.uploadDurationMs;

    const samples = [];

    const liveUpdater = setInterval(() => {
        const now = performance.now();

        if (now <= measureFrom) {
            $("status").textContent =
                "Warming up upload test";

            return;
        }

        const measuredMilliseconds =
            Math.max(
                1,
                now - measureFrom
            );

        const megabitsPerSecond =
            measuredBytes *
            8 /
            measuredMilliseconds /
            1000;

        samples.push(megabitsPerSecond);

        setGauge(
            megabitsPerSecond,
            "Uploading",
            CONFIG.gaugeMaxUpload
        );

        $("status").textContent =
            `Real-time upload · ${megabitsPerSecond.toFixed(2)} Mbps`;
    }, 200);

    await uploadWorker(
        payload,
        stopAt,
        (bytes) => {
            if (
                performance.now() >=
                measureFrom
            ) {
                measuredBytes += bytes;
            }
        }
    );

    clearInterval(liveUpdater);

    const elapsedMilliseconds =
        Math.max(
            1,
            performance.now() - measureFrom
        );

    const finalSpeed =
        measuredBytes *
        8 /
        elapsedMilliseconds /
        1000;

    const recentSamples =
        samples.slice(-20);

    const stableSpeed =
        recentSamples.length
            ? trimmedMean(
                recentSamples,
                0.15
            )
            : finalSpeed;

    return (
        finalSpeed * 0.75 +
        stableSpeed * 0.25
    );
}


async function runTest() {
    startButton.disabled = true;
    startButton.textContent = "TESTING…";

    try {
        const resultFields = [
            "download",
            "upload",
            "ping",
            "jitter"
        ];

        resultFields.forEach((id) => {
            $(id).textContent = "--";
        });

        setGauge(
            0,
            "Starting",
            CONFIG.gaugeMaxDownload
        );

        $("status").textContent =
            "Preparing real-time test";

        const latency =
            await pingTest();

        $("ping").textContent =
            latency.ping.toFixed(1);

        $("jitter").textContent =
            latency.jitter.toFixed(1);

        const downloadSpeed =
            await downloadTest();

        $("download").textContent =
            downloadSpeed.toFixed(2);

        await sleep(500);

        const uploadSpeed =
            await uploadTest();

        $("upload").textContent =
            uploadSpeed.toFixed(2);

        setGauge(
            downloadSpeed,
            "Complete",
            CONFIG.gaugeMaxDownload
        );

        $("status").textContent =
            "Speed test completed successfully";
    } catch (error) {
        console.error(error);

        $("phase").textContent =
            "Error";

        $("status").textContent =
            error.message ||
            "Speed test failed";
    } finally {
        startButton.disabled = false;
        startButton.textContent =
            "TEST AGAIN";
    }
}


startButton.addEventListener(
    "click",
    runTest
);


fetch(
    "/api/info",
    {
        cache: "no-store"
    }
)
    .then((response) => response.json())
    .then((data) => {
        $("clientIp").textContent =
            data.client_ip ||
            "Unknown";

        $("serverName").textContent =
            data.app ||
            "Mraprguild Speed Test";
    })
    .catch(() => {
        $("clientIp").textContent =
            "Unavailable";
    });
