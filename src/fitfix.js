import { Stream, Decoder, Encoder, Profile, Utils } from "@garmin/fitsdk";

const AUTO_LAP_DISTANCE = 1000;

// Message types that fixFit rebuilds itself. Everything else is carried over
// unchanged so re-encoding does not silently drop data such as file creator,
// sport settings, workouts, courses, segments, monitoring, or HRV messages.
const HANDLED_MESSAGE_KEYS = new Set([
    "fileIdMesgs",
    "developerDataIdMesgs",
    "fieldDescriptionMesgs",
    "deviceInfoMesgs",
    "eventMesgs",
    "recordMesgs",
    "lapMesgs",
    "sessionMesgs",
    "activityMesgs",
]);

// Decoder message buckets are keyed by name (e.g. "fileCreatorMesgs"), while
// the encoder needs the numeric FIT message id.
const MESG_NUM_BY_MESSAGES_KEY = new Map(
    Object.values(Profile.messages).map((mesg) => [
        mesg.messagesKey,
        mesg.num,
    ]),
);

// Convert pace string "mm:ss" to meters/second
function paceToMetersPerSecond(paceStr) {
    const [min, sec] = paceStr.split(":").map(Number);
    const totalSeconds = min * 60 + sec;
    return 1000 / totalSeconds;
}

// Build a LAP message from the accumulated stats of the lap that ends at
// endMesg. Shared by full and final partial auto-laps so both carry the same
// distance, speed, heart-rate, and cadence aggregates.
function buildAutoLapMesg(lap, endMesg) {
    const elapsedSeconds =
        (endMesg.timestamp.getTime() - lap.startTime.getTime()) / 1000;
    const totalDistance = endMesg.distance - lap.startDistance;
    const avgSpeed = elapsedSeconds > 0 ? totalDistance / elapsedSeconds : 0;

    const lapMesg = {
        mesgNum: Profile.MesgNum.LAP,
        timestamp: endMesg.timestamp,
        startTime: lap.startTime,
        lapTrigger: "distance",
        totalTimerTime: elapsedSeconds,
        totalElapsedTime: elapsedSeconds,
        totalDistance,
        avgSpeed,
        maxSpeed: lap.maxSpeed,
        enhancedMaxSpeed: lap.enhancedMaxSpeed,
        enhancedAvgSpeed: avgSpeed,
    };

    // Only emit aggregates when the lap actually contains samples, otherwise
    // the FIT fields would be written with out-of-range placeholder values.
    if (lap.countHeartRate > 0) {
        lapMesg.minHeartRate = lap.minHeartRate;
        lapMesg.avgHeartRate = lap.sumHeartRate / lap.countHeartRate;
        lapMesg.maxHeartRate = lap.maxHeartRate;
    }
    if (lap.countCadence > 0) {
        lapMesg.avgCadence = lap.sumCadence / lap.countCadence;
        lapMesg.maxCadence = lap.maxCadence;
    }

    return lapMesg;
}

function addAutoLaps(mesgs, autoLapDistance = AUTO_LAP_DISTANCE) {
    const recordMesgs = mesgs.filter(
        (m) => m.mesgNum === Profile.MesgNum.RECORD,
    );

    if (recordMesgs.length === 0) {
        return;
    }

    const firstRecord = recordMesgs[0];
    let currentLap = {
        timestamp: firstRecord.timestamp,
        startTime: firstRecord.timestamp,
        startDistance: 0,
        maxSpeed: 0,
        enhancedMaxSpeed: 0,
        sumHeartRate: 0,
        countHeartRate: 0,
        maxHeartRate: 0,
        minHeartRate: 1000,
        sumCadence: 0,
        countCadence: 0,
        maxCadence: 0,
    };

    for (const mesg of recordMesgs) {
        const distance = mesg.distance;
        if (mesg.speed > currentLap.maxSpeed) {
            currentLap.maxSpeed = mesg.speed;
        }
        if (mesg.enhancedSpeed > currentLap.enhancedMaxSpeed) {
            currentLap.enhancedMaxSpeed = mesg.enhancedSpeed;
        }
        if (mesg.heartRate) {
            if (mesg.heartRate > currentLap.maxHeartRate) {
                currentLap.maxHeartRate = mesg.heartRate;
            }
            if (mesg.heartRate < currentLap.minHeartRate) {
                currentLap.minHeartRate = mesg.heartRate;
            }
            currentLap.sumHeartRate += mesg.heartRate;
            currentLap.countHeartRate += 1;
        }
        if (mesg.cadence) {
            if (mesg.cadence > currentLap.maxCadence) {
                currentLap.maxCadence = mesg.cadence;
            }
            currentLap.sumCadence += mesg.cadence;
            currentLap.countCadence += 1;
        }

        if (
            Math.round((distance - currentLap.startDistance) * 100) / 100 >=
            autoLapDistance
        ) {
            const lap = buildAutoLapMesg(currentLap, mesg);
            mesgs.push(lap);

            currentLap = {
                timestamp: mesg.timestamp,
                startTime: mesg.timestamp,
                startDistance: distance,
                maxSpeed: 0,
                enhancedMaxSpeed: 0,
                sumHeartRate: 0,
                countHeartRate: 0,
                maxHeartRate: 0,
                minHeartRate: 1000,
                sumCadence: 0,
                countCadence: 0,
                maxCadence: 0,
            };
        }
    }

    const lastRecord = recordMesgs[recordMesgs.length - 1];
    mesgs.push(buildAutoLapMesg(currentLap, lastRecord));
}

function fixFit(
    buffer,
    { autolap = false, keepLaps = false, speed = null, speeds = null } = {},
) {
    if (speed == null && speeds == null) {
        throw new Error("Please supply either a speed or speeds");
    } else if (speed != null) {
        if (typeof speed != "number") {
            throw new Error("Speed must be of type 'number'");
        }
    } else if (speeds != null) {
        if (!Array.isArray(speeds)) {
            throw new Error("Speeds must be an array");
        }
        if (keepLaps) {
            throw new Error("keepLaps must be false when speeds are supplied");
        }
    }

    const fixedSpeed = speed;

    const stream = Stream.fromArrayBuffer(buffer);
    const decoder = new Decoder(stream);
    const { messages, errors } = decoder.read({});

    if (errors.length > 0) {
        throw new Error("Decoding failed with errors: " + errors.join(", "));
    }

    const mesgs = [];
    if (speeds) {
        if (
            !messages.lapMesgs ||
            messages.lapMesgs.length !== speeds.length
        ) {
            throw new Error(
                "Speeds array length must match lap length in fit file",
            );
        }
    }

    // Every FIT file MUST contain a File ID message
    mesgs.push({
        mesgNum: Profile.MesgNum.FILE_ID,
        ...messages.fileIdMesgs[0],
    });

    // Create the Developer Id message for the developer data fields.
    const fieldDescriptions = {};
    if (messages.developerDataIdMesgs && messages.developerDataIdMesgs.length >= 1) {
        const developerDataIdMesg = {
            mesgNum: Profile.MesgNum.DEVELOPER_DATA_ID,
            ...messages.developerDataIdMesgs[0],
        };
        mesgs.push(developerDataIdMesg);

        messages.fieldDescriptionMesgs.map((mesg) => {
            const fieldDescMesg = {
                mesgNum: Profile.MesgNum.FIELD_DESCRIPTION,
                ...mesg,
            };

            if (fieldDescMesg.fitBaseTypeId == Utils.FitBaseType.STRING) {
                fieldDescMesg.type = "string";
            }

            mesgs.push(fieldDescMesg);

            fieldDescriptions[mesg.key] = {
                developerDataIdMesg: developerDataIdMesg,
                fieldDescriptionMesg: fieldDescMesg,
            };
        });
    }

    if (messages.deviceInfoMesgs) {
        messages.deviceInfoMesgs.map((mesg) => {
            mesgs.push({
                mesgNum: Profile.MesgNum.DEVICE_INFO,
                ...mesg,
            });
        });
    }

    if (messages.eventMesgs) {
        messages.eventMesgs.map((mesg) => {
            mesgs.push({
                mesgNum: Profile.MesgNum.EVENT,
                ...mesg,
            });
        });
    }

    let distance = 0;
    let totalElapsedTime = 0;
    // Per-lap totals derived from the rewritten records, so pauses (records
    // written with zero speed) are reflected in lap distance and avg speed.
    const lapStats =
        speeds && messages.lapMesgs
            ? messages.lapMesgs.map(() => ({
                  distance: 0,
                  timerTime: 0,
                  elapsedTime: 0,
              }))
            : null;

    if (messages.recordMesgs && messages.recordMesgs.length > 0) {
        let lapIndex = 0;
        let prevMesg = messages.recordMesgs[0]; // we lose the first second, but ... whatever

        messages.recordMesgs.map((mesg) => {
            if (speeds) {
                if (lapIndex < speeds.length - 1) {
                    if (
                        mesg.timestamp >=
                        messages.lapMesgs[lapIndex + 1].startTime
                    ) {
                        lapIndex++;
                    }
                }
                speed = speeds[lapIndex];
            } else {
                speed = fixedSpeed;
            }

            // set speed to 0 if we are currently stopped
            if (messages.eventMesgs && messages.eventMesgs.length >= 1) {
                let lastEvent = null;
                for (const event of messages.eventMesgs) {
                    if (
                        event.timestamp < mesg.timestamp &&
                        (!lastEvent ||
                            event.timestamp > lastEvent.timestamp)
                    ) {
                        lastEvent = event;
                    }
                }
                if (lastEvent && lastEvent.eventType == "stop") {
                    speed = 0;
                }
            }
            const elapsed =
                (mesg.timestamp.getTime() - prevMesg.timestamp.getTime()) /
                1000;
            distance = prevMesg.distance + elapsed * speed;
            totalElapsedTime += elapsed;

            if (lapStats && lapStats[lapIndex]) {
                const stats = lapStats[lapIndex];
                const lapDistance = elapsed * speed;
                stats.distance += lapDistance;
                stats.elapsedTime += elapsed;
                if (speed > 0) {
                    stats.timerTime += elapsed;
                }
            }

            const recordMesg = {};
            recordMesg.mesgNum = Profile.MesgNum.RECORD;
            for (const key of Object.keys(mesg)) {
                if (key === "distance" || key === "speed" || key === "enhancedSpeed") {
                    continue;
                }
                recordMesg[key] = mesg[key];
            }
            recordMesg.distance = distance;
            recordMesg.speed = speed;
            recordMesg.enhancedSpeed = speed;
            prevMesg = recordMesg;

            mesgs.push(recordMesg);
        });
    }

    if (keepLaps) {
        if (messages.lapMesgs) {
            messages.lapMesgs.map((mesg) => {
                mesgs.push({
                    mesgNum: Profile.MesgNum.LAP,
                    ...mesg,
                });
            });
        }
    } else if (speeds != null) {
        if (messages.lapMesgs) {
            messages.lapMesgs.map((mesg, index) => {
                const stats = lapStats[index];
                const totalDistance = stats
                    ? stats.distance
                    : speeds[index] * mesg.totalTimerTime;
                // Prefer the device's timer time (which excludes pauses),
                // falling back to the times measured from the records.
                const timerTime =
                    mesg.totalTimerTime > 0
                        ? mesg.totalTimerTime
                        : stats
                          ? stats.timerTime || stats.elapsedTime
                          : 0;
                const avgSpeed =
                    timerTime > 0 ? totalDistance / timerTime : speeds[index];

                const lapMesg = {
                    mesgNum: Profile.MesgNum.LAP,
                    ...mesg,
                    totalDistance,
                    avgSpeed,
                    maxSpeed: speeds[index],
                    enhancedMaxSpeed: speeds[index],
                    enhancedAvgSpeed: avgSpeed,
                };
                mesgs.push(lapMesg);
            });
        }
    } else if (autolap) {
        if (!messages.recordMesgs || messages.recordMesgs.length === 0) {
            throw new Error(
                "Cannot generate auto-laps: the FIT file contains no record messages",
            );
        }
        addAutoLaps(mesgs, 1000);
    }

    let maxSpeed = 0;
    const laps = mesgs.filter((m) => m.mesgNum === Profile.MesgNum.LAP);
    for (const lap of laps) {
        if (lap.maxSpeed > maxSpeed) {
            maxSpeed = lap.maxSpeed;
        }
    }

    if (messages.sessionMesgs && messages.sessionMesgs.length > 0) {
        const mesg = messages.sessionMesgs[0];
        // Fall back to elapsed time (or the record timestamps) when the
        // source session has no totalTimerTime, which would otherwise make
        // avgSpeed NaN.
        const sessionTime =
            mesg.totalTimerTime > 0
                ? mesg.totalTimerTime
                : mesg.totalElapsedTime > 0
                  ? mesg.totalElapsedTime
                  : totalElapsedTime;
        const avgSpeed =
            sessionTime > 0 ? distance / sessionTime : mesg.avgSpeed;

        const sessionMesg = {
            mesgNum: Profile.MesgNum.SESSION,
            ...mesg,
            totalDistance: distance,
            maxSpeed: maxSpeed,
            enhancedMaxSpeed: maxSpeed,
        };
        if (Number.isFinite(avgSpeed)) {
            sessionMesg.avgSpeed = avgSpeed;
            sessionMesg.enhancedAvgSpeed = avgSpeed;
        }
        mesgs.push(sessionMesg);
    }

    // Carry over every message type fixFit does not rebuild above.
    for (const [key, mesgList] of Object.entries(messages)) {
        if (HANDLED_MESSAGE_KEYS.has(key) || !Array.isArray(mesgList)) {
            continue;
        }

        const mesgNum = MESG_NUM_BY_MESSAGES_KEY.get(key);
        if (mesgNum === undefined) {
            // Unknown-message buckets are keyed by their raw message number
            // and have no decoded fields with the default read options.
            continue;
        }

        for (const mesg of mesgList) {
            mesgs.push({ mesgNum, ...mesg });
        }
    }

    // Only the first session is rewritten; keep any additional sessions.
    if (messages.sessionMesgs) {
        for (const mesg of messages.sessionMesgs.slice(1)) {
            mesgs.push({ mesgNum: Profile.MesgNum.SESSION, ...mesg });
        }
    }

    if (messages.activityMesgs) {
        messages.activityMesgs.map((mesg) => {
            mesgs.push({
                mesgNum: Profile.MesgNum.ACTIVITY,
                ...mesg,
            });
        });
    }

    try {
        // Create an Encoder and provide the developer data field descriptions
        const encoder = new Encoder({ fieldDescriptions });

        // Write each message to the encoder
        mesgs.forEach((mesg) => {
            encoder.writeMesg(mesg);
        });

        // Close the encoder
        const uint8Array = encoder.close();
        return uint8Array;
    } catch (error) {
        console.error(
            error.name,
            error.message,
            JSON.stringify(error?.cause, null, 2),
        );

        throw error;
    }
}

export { fixFit, paceToMetersPerSecond };
