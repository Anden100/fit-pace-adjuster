import { Stream, Decoder, Encoder, Profile, Utils } from "./fitsdk";

const AUTO_LAP_DISTANCE = 1000;

// Convert pace string "mm:ss" to meters/second
function paceToMetersPerSecond(paceStr) {
    const [min, sec] = paceStr.split(":").map(Number);
    const totalSeconds = min * 60 + sec;
    return 1000 / totalSeconds;
}

function addAutoLaps(mesgs, autoLapDistance = AUTO_LAP_DISTANCE) {
    const recordMesgs = mesgs.filter(
        (m) => m.mesgNum === Profile.MesgNum.RECORD
    );

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
        minCadence: 1000,
    };

    for (const mesg of recordMesgs) {
        const distance = mesg.distance;
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
            if (mesg.cadence < currentLap.minCadence) {
                currentLap.minCadence = mesg.cadence;
            }
            currentLap.sumCadence += mesg.cadence;
            currentLap.countCadence += 1;
        }

        if (
            Math.round((distance - currentLap.startDistance) * 100) / 100 >=
            autoLapDistance
        ) {
            const lap = {
                mesgNum: Profile.MesgNum.LAP,
                timestamp: mesg.timestamp,
                startTime: currentLap.startTime,
                lapTrigger: "distance",
                totalTimerTime:
                    (mesg.timestamp.getTime() -
                        currentLap.startTime.getTime()) /
                    1000,
                totalElapsedTime:
                    (mesg.timestamp.getTime() -
                        currentLap.startTime.getTime()) /
                    1000,
                totalDistance: distance - currentLap.startDistance,
                avgSpeed:
                    (distance - currentLap.startDistance) /
                    ((mesg.timestamp.getTime() -
                        currentLap.startTime.getTime()) /
                        1000),
                maxSpeed: currentLap.maxSpeed,
                enhancedMaxSpeed: currentLap.enhancedMaxSpeed,
                enhancedAvgSpeed:
                    (distance - currentLap.startDistance) /
                    ((mesg.timestamp.getTime() -
                        currentLap.startTime.getTime()) /
                        1000),
                minHeartRate: currentLap.minHeartRate,
                avgHeartRate:
                    currentLap.countHeartRate > 0
                        ? currentLap.sumHeartRate / currentLap.countHeartRate
                        : 0,
                maxHeartRate: currentLap.maxHeartRate,
                minCadence: currentLap.minCadence,
                avgCadence:
                    currentLap.countCadence > 0
                        ? currentLap.sumCadence / currentLap.countCadence
                        : 0,
                maxCadence: currentLap.maxCadence,
            };
            mesgs.push(lap);

            currentLap = {
                timestamp: mesg.timestamp,
                startTime: mesg.timestamp,
                startDistance: distance,
                // maxSpeed: 0,
                enhancedMaxSpeed: 0,
                sumHeartRate: 0,
                countHeartRate: 0,
                maxHeartRate: 0,
                minHeartRate: 1000,
                sumCadence: 0,
                countCadence: 0,
                maxCadence: 0,
                minCadence: 1000,
            };
        }
    }

    const avgSpeed =
        (mesg.distance - currentLap.startDistance) /
        ((mesg.timestamp.getTime() - currentLap.startTime.getTime()) / 1000);

    const mesg = recordMesgs[recordMesgs.length - 1];
    mesgs.push({
        mesgNum: Profile.MesgNum.LAP,
        timestamp: mesg.timestamp,
        startTime: currentLap.startTime,
        lapTrigger: "distance",
        totalTimerTime:
            (mesg.timestamp.getTime() - currentLap.startTime.getTime()) / 1000,
        totalElapsedTime:
            (mesg.timestamp.getTime() - currentLap.startTime.getTime()) / 1000,
        totalDistance: mesg.distance - currentLap.startDistance,
        avgSpeed,
        maxSpeed: currentLap.maxSpeed,
        enhancedMaxSpeed: currentLap.enhancedMaxSpeed,
        enhancedAvgSpeed: avgSpeed,
    });
}

function fixFit(
    buffer,
    { autolap = false, keepLaps = false, speed = null, speeds = null } = {}
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

    const stream = Stream.fromArrayBuffer(buffer);
    const decoder = new Decoder(stream);
    const { messages, errors } = decoder.read({});

    if (errors.length > 0) {
        throw new Error("Decoding failed with errors: " + errors.join(", "));
    }

    const mesgs = [];
    if (speeds && messages.lapMesgs.length !== speeds.length) {
        throw new Error(
            "Speeds array length must match lap length in fit file"
        );
    }

    // Every FIT file MUST contain a File ID message
    mesgs.push({
        mesgNum: Profile.MesgNum.FILE_ID,
        ...messages.fileIdMesgs[0],
    });

    // Create the Developer Id message for the developer data fields.
    const developerDataIdMesg = {
        mesgNum: Profile.MesgNum.DEVELOPER_DATA_ID,
        ...messages.developerDataIdMesgs[0],
    };
    mesgs.push(developerDataIdMesg);

    const fieldDescriptions = {};
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

    if (messages.deviceInfoMesgs) {
        messages.deviceInfoMesgs.map((mesg) => {
            mesgs.push({
                mesgNum: Profile.MesgNum.DEVICE_INFO,
                ...mesg,
            });
        });
    }

    let distance = 0;
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
            }
            const elapsed =
                (mesg.timestamp.getTime() - prevMesg.timestamp.getTime()) /
                1000;
            distance = prevMesg.distance + elapsed * speed;

            const recordMesg = {
                mesgNum: Profile.MesgNum.RECORD,
                ...mesg,
                distance,
                speed,
                enhancedSpeed: speed,
            };
            prevMesg = recordMesg;
            mesgs.push(recordMesg);
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
                const lapMesg = {
                    mesgNum: Profile.MesgNum.LAP,
                    ...mesg,
                    avgSpeed: speeds[index],
                    maxSpeed: speeds[index],
                    enhancedMaxSpeed: speeds[index],
                    enhancedAvgSpeed: speeds[index],
                    totalDistance: speeds[index] * mesg.totalTimerTime,
                };
                mesgs.push(lapMesg);
            });
        }
    } else if (autolap) {
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
        const sessionMesg = {
            mesgNum: Profile.MesgNum.SESSION,
            ...mesg,
            totalDistance: distance,
            maxSpeed: maxSpeed,
            avgSpeed: distance / mesg.totalTimerTime,
            enhancedMaxSpeed: maxSpeed,
            enhancedAvgSpeed: distance / mesg.totalTimerTime,
        };
        mesgs.push(sessionMesg);
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
            JSON.stringify(error?.cause, null, 2)
        );

        throw error;
    }
}

// const buf = fs.readFileSync("6964a2c052f1f04e57c8187a.fit");
// const speed = paceToMetersPerSecond("6:00");
// const corrected = fixFit(buf.buffer, {
//     keepLaps: false,
//     autolap: true,
//     speed,
// });

// const speeds = [
//     paceToMetersPerSecond("06:00"),
//     paceToMetersPerSecond("04:45"),
//     0,
//     paceToMetersPerSecond("04:45"),
//     0,
//     paceToMetersPerSecond("04:45"),
//     0,
//     paceToMetersPerSecond("04:45"),
//     0,
//     paceToMetersPerSecond("04:45"),
//     0,
//     paceToMetersPerSecond("04:45"),
//     0,
//     paceToMetersPerSecond("06:15"),
// ];
//
// const corrected = fixFit(buf.buffer, {
//     speeds,
// });

// fs.writeFileSync("out.fit", corrected);

export { fixFit, paceToMetersPerSecond };
