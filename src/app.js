import Alpine from "alpinejs";
import { Decoder, Stream, Profile } from "./fitsdk";
import { fixFit } from "./fitfix.js";

window.Alpine = Alpine;

Alpine.data("app", () => ({
    // File handling
    fitFile: null,
    originalBuffer: null,
    isDragOver: false,
    isLoading: false,
    errorMessage: "",

    // Workout data
    workoutData: null,
    decodedMessages: null,

    // Pace adjustment
    paceMode: "single",
    paceUnit: "km",
    singlePace: "",
    autoLapEnabled: true,
    lapDistances: [],
    lapPaces: [],

    // Processing state
    isProcessing: false,
    isValid: false,

    init() {
        this.lapPaces = [];
    },

    handleFileSelect(event) {
        const file = event.target.files[0];
        if (file) {
            this.processFile(file);
        }
    },

    handleFileDrop(event) {
        this.isDragOver = false;
        const file = event.dataTransfer.files[0];
        if (file && file.name.toLowerCase().endsWith(".fit")) {
            this.processFile(file);
        } else {
            this.showError("Please select a valid .FIT file");
        }
    },

    clearFile() {
        this.fitFile = null;
        this.originalBuffer = null;
        this.workoutData = null;
        this.decodedMessages = null;
        this.errorMessage = "";
        this.lapPaces = [];
        this.lapDistances = [];
        this.singlePace = "";
        this.autoLapEnabled = true;
        this.isValid = false;
        // Clear file input
        const fileInput = document.getElementById("fitFile");
        if (fileInput) fileInput.value = "";
    },

    async processFile(file) {
        if (!file.name.toLowerCase().endsWith(".fit")) {
            this.showError("Please select a valid .FIT file");
            return;
        }

        this.fitFile = file;
        this.isLoading = true;
        this.errorMessage = "";
        this.workoutData = null;
        this.decodedMessages = null;

        try {
            const arrayBuffer = await file.arrayBuffer();
            this.originalBuffer = arrayBuffer;
            const stream = Stream.fromArrayBuffer(arrayBuffer);

            if (!Decoder.isFIT(stream)) {
                throw new Error("This is not a valid FIT file");
            }

            const decoder = new Decoder(stream);
            const { messages, errors } = decoder.read({
                applyScaleAndOffset: true,
                expandSubFields: true,
                expandComponents: true,
                convertTypesToStrings: true,
                convertDateTimesToDates: true,
                includeUnknownData: true,
                mergeHeartRates: true,
            });

            if (errors.length > 0) {
                console.warn("FIT decoding errors:", errors);
            }

            // Debug: Log the decoded messages structure
            console.log("Decoded messages:", messages);
            console.log("Available message types:", Object.keys(messages));

            this.decodedMessages = messages;
            this.parseWorkoutData(messages);
            this.isValid = true;
        } catch (error) {
            console.error("Error processing FIT file:", error);
            this.showError(error.message || "Error processing FIT file");
        } finally {
            this.isLoading = false;
        }
    },

    parseWorkoutData(messages) {
        console.log("Parsing workout data from messages:", messages);

        const workoutData = {
            activityType: "Unknown",
            startTime: null,
            totalDistance: 0,
            totalTime: 0,
            laps: [],
        };

        // Extract file info
        if (messages.fileIdMesgs && messages.fileIdMesgs.length > 0) {
            const fileId = messages.fileIdMesgs[0];
            console.log("File ID message:", fileId);
            workoutData.activityType = fileId.type || "Unknown";
            workoutData.startTime = fileId.timeCreated;
        }

        // Extract session data
        if (messages.sessionMesgs && messages.sessionMesgs.length > 0) {
            const session = messages.sessionMesgs[0];
            console.log("Session message:", session);
            workoutData.totalDistance = session.totalDistance || 0;
            workoutData.totalTime = session.totalElapsedTime || session.totalTimerTime || 0;
        }

        // Extract lap data
        if (messages.lapMesgs && messages.lapMesgs.length > 0) {
            console.log("Lap messages:", messages.lapMesgs);
            workoutData.laps = messages.lapMesgs.map((lap) => ({
                distance: lap.totalDistance || 0,
                time: lap.totalElapsedTime || lap.totalTimerTime || 0,
                avgPace: this.calculatePace(
                    lap.totalDistance,
                    lap.totalElapsedTime || lap.totalTimerTime
                ),
            }));
        }

        console.log("Parsed workout data:", workoutData);
        console.log("workoutData.laps:", workoutData.laps, Array.isArray(workoutData.laps));

        this.workoutData = workoutData;
        this.lapPaces = new Array(workoutData.laps.length).fill("");
        this.lapDistances = new Array(workoutData.laps.length).fill("");

        // Reset to single pace mode if there are fewer than 2 laps
        if (!workoutData.laps || workoutData.laps.length < 2) {
            this.paceMode = 'single';
        }

        this.updateValidity();
    },

    calculatePace(distance, time) {
        if (!distance || !time || distance === 0) return 0;
        // Convert to min/km (distance in meters, time in seconds)
        return time / 60 / (distance / 1000);
    },

        validatePace(event, type, index = null) {
            const value = event.target.value;
            const paceRegex = /^(\d{1,2}):([0-5]\d)$/;

            if (!paceRegex.test(value) && value !== "") {
                event.target.setCustomValidity("Please enter pace in format MM:SS");
            } else {
                event.target.setCustomValidity("");
                // Update distance when pace is valid
                if (type === 'lap' && paceRegex.test(value) && this.workoutData.laps[index]) {
                    const paceSeconds = this.parsePace(value);
                    const speed = 1000 / paceSeconds; // m/s
                    const distance = speed * this.workoutData.laps[index].time;
                    this.lapDistances[index] = Math.round(distance) || "";
                }
            }

            this.updateValidity();
        },

        updateValidity() {
            const paceRegex = /^(\d{1,2}):([0-5]\d)$/;
            if (this.paceMode === "single") {
                this.isValid = this.singlePace && paceRegex.test(this.singlePace);
            } else {
                this.isValid = this.lapPaces.every(
                    (pace) => pace === "" || paceRegex.test(pace)
                );
            }
        },

    updatePaceFromDistance(index) {
        const distance = parseFloat(this.lapDistances[index]);
        if (!isNaN(distance) && distance > 0 && this.workoutData.laps[index] && this.workoutData.laps[index].time > 0) {
            const timeHours = this.workoutData.laps[index].time / 3600;
            const distanceKm = distance / 1000;
            const paceMinPerKm = (timeHours / distanceKm) * 60;
            const minutes = Math.floor(paceMinPerKm);
            const seconds = Math.round((paceMinPerKm - minutes) * 60);
            if (seconds >= 60) {
                this.lapPaces[index] = `${minutes + 1}:00`;
            } else {
                this.lapPaces[index] = `${minutes}:${seconds.toString().padStart(2, '0')}`;
            }
        }
    },

    checkValidation() {
        if (this.paceMode === "single") {
            this.isValid =
                this.singlePace !== "" &&
                /^(\d{1,2}):([0-5]\d)$/.test(this.singlePace);
        } else {
            this.isValid = this.lapPaces.every(
                (pace) => pace !== "" && /^(\d{1,2}):([0-5]\d)$/.test(pace)
            );
        }
    },

        async adjustAndDownload() {
            if (this.paceMode === "single") {
                if (!this.singlePace) {
                    this.showError("Please enter a target pace");
                    return;
                }

                const paceRegex = /^(\d{1,2}):([0-5]\d)$/;
                if (!paceRegex.test(this.singlePace)) {
                    this.showError("Please enter a valid pace in MM:SS format");
                    return;
                }

                const targetPaceSeconds = this.parsePace(this.singlePace);
                const targetSpeed = 1000 / targetPaceSeconds; // m/s

                const options = { speed: targetSpeed, autolap: this.autoLapEnabled };
                this.adjustPaces(options);
            } else {
                // Per-lap pace adjustment
                const invalidPaces = this.lapPaces.filter(
                    (pace) => pace !== "" && !/^(\d{1,2}):([0-5]\d)$/.test(pace)
                );
                if (invalidPaces.length > 0) {
                    this.showError("Please correct invalid paces");
                    return;
                }

                const speeds = this.lapPaces.map((pace) => pace ? 1000 / this.parsePace(pace) : 0);

                const options = { speeds, autolap: this.autoLapEnabled };
                this.adjustPaces(options);
            }
        },

    adjustPaces(options) {
        this.isProcessing = true;
        try {
            const corrected = fixFit(this.originalBuffer, options);
            this.downloadFile(corrected, this.getOutputFilename());
        } catch (error) {
            console.error("Error adjusting paces:", error);
            this.showError("Error adjusting paces: " + error.message);
        } finally {
            this.isProcessing = false;
        }
    },

    parsePace(paceString) {
        const [minutes, seconds] = paceString.split(":").map(Number);
        return minutes * 60 + seconds; // Convert to seconds per km/mile
    },

    adjustSinglePace(messages, targetPaceSeconds) {
        // Calculate target speed from pace
        const distanceUnit = this.paceUnit === "km" ? 1000 : 1609.34; // meters per km or mile
        const targetSpeed = distanceUnit / targetPaceSeconds; // meters per second

        // Adjust session data
        if (messages.session && messages.session.length > 0) {
            const session = messages.session[0];
            if (session.total_distance && session.total_elapsed_time) {
                session.avg_speed = targetSpeed;
                // Recalculate pace if stored
                if (session.avg_pace) {
                    session.avg_pace = targetPaceSeconds;
                }
            }
        }

        // Adjust lap data
        if (messages.lapMesgs && messages.lapMesgs.length > 0) {
            messages.lapMesgs.forEach((lap) => {
                if (lap.totalDistance) {
                    lap.totalElapsedTime = lap.totalDistance / targetSpeed;
                    lap.totalTimerTime = lap.totalElapsedTime;
                    lap.avgSpeed = targetSpeed;
                }
            });
        }

        // Adjust record data (individual data points)
        if (messages.recordMesgs && messages.recordMesgs.length > 0) {
            let cumulativeDistance = 0;
            let cumulativeTime = 0;

            messages.recordMesgs.forEach((record, index) => {
                if (record.distance) {
                    cumulativeDistance = record.distance;
                    cumulativeTime = cumulativeDistance / targetSpeed;
                    record.timestamp = new Date(
                        (this.workoutData.startTime.getTime() / 1000 +
                            cumulativeTime) *
                            1000
                    );
                    record.speed = targetSpeed;

                    // Adjust heart rate if present (optional - could scale proportionally)
                    if (record.heartRate && index > 0) {
                        // Keep original heart rate pattern
                    }
                }
            });
        }
    },

    adjustLapPaces(messages, targetPaceSeconds) {
        // Adjust lap data with individual paces
        if (messages.lap && messages.lap.length > 0) {
            messages.lap.forEach((lap, index) => {
                if (
                    lap.total_distance &&
                    !isNaN(targetPaceSeconds[index])
                ) {
                    const distanceUnit =
                        this.paceUnit === "km" ? 1000 : 1609.34;
                    const targetSpeed = distanceUnit / targetPaceSeconds[index];

                    lap.total_elapsed_time = lap.total_distance / targetSpeed;
                    lap.total_timer_time = lap.total_elapsed_time;
                    lap.avg_speed = targetSpeed;
                }
            });
        }

        // For simplicity, we'll adjust records based on lap timing
        // This is a complex operation that would require more sophisticated logic
        // For now, we'll adjust the overall session pace to match the average of lap paces
        const avgPace =
            targetPaceSeconds.reduce((a, b) => a + b, 0) /
            targetPaceSeconds.length;

        if (messages.session && messages.session.length > 0) {
            const session = messages.session[0];
            if (session.total_distance) {
                const distanceUnit = this.paceUnit === "km" ? 1000 : 1609.34;
                session.avg_speed = distanceUnit / avgPace;
            }
        }

        // Note: Adjusting individual record points per lap would require more complex logic
        // For this initial version, we'll keep the original record timing
    },

    addMessagesToEncoder(encoder, messages) {
        // Add messages in the correct order
        const messageOrder = [
            "file_id",
            "file_creator",
            "software",
            "capabilities",
            "device_info",
            "session",
            "lap",
            "record",
            "event",
            "device_info",
        ];

        messageOrder.forEach((messageType) => {
            if (messages[messageType]) {
                messages[messageType].forEach((message) => {
                    const mesgNum = this.getMessageNumber(messageType);
                    if (mesgNum) {
                        encoder.onMesg(mesgNum, message);
                    }
                });
            }
        });
    },

    getMessageNumber(messageType) {
        const messageTypes = {
            file_id: Profile.MesgNum.FILE_ID,
            file_creator: Profile.MesgNum.FILE_CREATOR,
            software: Profile.MesgNum.SOFTWARE,
            capabilities: Profile.MesgNum.CAPABILITIES,
            device_info: Profile.MesgNum.DEVICE_INFO,
            session: Profile.MesgNum.SESSION,
            lap: Profile.MesgNum.LAP,
            record: Profile.MesgNum.RECORD,
            event: Profile.MesgNum.EVENT,
        };
        return messageTypes[messageType];
    },

    downloadFile(data, filename) {
        const blob = new Blob([data], { type: "application/octet-stream" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    },

    getOutputFilename() {
        if (!this.fitFile) return "adjusted.fit";
        const originalName = this.fitFile.name.replace(".fit", "");
        return `${originalName}_adjusted.fit`;
    },

    showError(message) {
        this.errorMessage = message;
        setTimeout(() => {
            this.errorMessage = "";
        }, 5000);
    },

    formatFileSize(bytes) {
        if (bytes === 0) return "0 Bytes";
        const k = 1024;
        const sizes = ["Bytes", "KB", "MB", "GB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
    },

    formatDate(date) {
        if (!date) return "Unknown";
        return date.toLocaleDateString() + " " + date.toLocaleTimeString();
    },

    formatDistance(meters) {
        if (!meters) return "0.00 km";
        const km = meters / 1000;
        return km.toFixed(2) + " km";
    },

    formatDuration(seconds) {
        if (!seconds) return "0:00";
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.floor(seconds % 60);
        return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
    },

    formatPace(paceMinutes) {
        if (!paceMinutes || paceMinutes === 0) return "0:00";
        const minutes = Math.floor(paceMinutes);
        const seconds = Math.floor((paceMinutes - minutes) * 60);
        return `${minutes}:${seconds.toString().padStart(2, "0")}`;
    },
}));

Alpine.start();
