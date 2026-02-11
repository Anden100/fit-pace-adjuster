import Alpine from "alpinejs";
import { Decoder, Stream } from "@garmin/fitsdk";
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

    // single pace
    singleSpeedMS: 0,
    singlePace: "",
    singleSpeed: "",
    singleDistance: "",
    autoLapEnabled: true,

    // multi lap
    lapSpeedsMS: [],
    lapDistances: [],
    lapPaces: [],
    lapSpeeds: [],

    // Processing state
    isProcessing: false,
    isValid: false,

    init() {
        this.lapSpeedsMS = [];
        this.lapPaces = [];
        this.lapDistances = [];
        this.lapSpeeds = [];
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
        this.lapSpeeds = [];
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
            workoutData.totalTime =
                session.totalElapsedTime || session.totalTimerTime || 0;
        }

        // Extract lap data
        if (messages.lapMesgs && messages.lapMesgs.length > 0) {
            console.log("Lap messages:", messages.lapMesgs);
            workoutData.laps = messages.lapMesgs.map((lap) => ({
                distance: lap.totalDistance || 0,
                time: lap.totalElapsedTime || lap.totalTimerTime || 0,
                avgPace: this.calculatePace(
                    lap.totalDistance,
                    lap.totalElapsedTime || lap.totalTimerTime,
                ),
            }));
        }

        console.log("Parsed workout data:", workoutData);
        console.log(
            "workoutData.laps:",
            workoutData.laps,
            Array.isArray(workoutData.laps),
        );

        this.workoutData = workoutData;
        this.lapSpeedsMS = new Array(workoutData.laps.length).fill(0);
        this.lapPaces = new Array(workoutData.laps.length).fill("");
        this.lapDistances = new Array(workoutData.laps.length).fill("");
        this.lapSpeeds = new Array(workoutData.laps.length).fill("");

        // Reset to single pace mode if there are fewer than 2 laps
        if (!workoutData.laps || workoutData.laps.length < 2) {
            this.paceMode = "single";
        }

        this.updateValidity();
    },

    calculatePace(distance, time) {
        if (!distance || !time || distance === 0) return 0;
        // Convert to min/km (distance in meters, time in seconds)
        return time / 60 / (distance / 1000);
    },

    speedToPace(speed) {
        if (!speed || speed <= 0) return "";
        const paceMinPerKm = 1000 / (speed * 60);
        const minutes = Math.floor(paceMinPerKm);
        const seconds = Math.round((paceMinPerKm - minutes) * 60);
        return `${minutes}:${seconds.toString().padStart(2, "0")}`;
    },

    paceToSpeed(paceStr) {
        if (!paceStr) return "";
        const [minutes, seconds] = paceStr.split(":").map(Number);
        const totalMinutes = minutes + seconds / 60;
        return parseFloat(60 / totalMinutes / 3.6);
    },

    updateSpeed(speedMS, type, index = null) {
        const time = type === "single"
            ? this.workoutData.totalTime
            : this.workoutData.laps[index].time;
        const distance = Math.round(speedMS * time) || "";
        const pace = this.speedToPace(speedMS);
        const speedKMH = (speedMS * 3.6).toFixed(1);

        if (type === "single") {
            this.singleSpeedMS = speedMS;
            this.singlePace = pace;
            this.singleSpeed = speedKMH;
            this.singleDistance = distance;
        } else {
            this.lapSpeedsMS[index] = speedMS;
            this.lapPaces[index] = pace;
            this.lapSpeeds[index] = speedKMH;
            this.lapDistances[index] = distance;
        }
    },

    validatePace(event, type, index = null) {
        const value = event.target.value;
        const paceRegex = /^(\d{1,2}):([0-5]\d)$/;

        if (!paceRegex.test(value) && value !== "") {
            event.target.setCustomValidity("Please enter pace in format MM:SS");
        } else {
            event.target.setCustomValidity("");
            if (paceRegex.test(value)) {
                const speedMS = this.paceToSpeed(value);
                this.updateSpeed(speedMS, type, index);
            }
        }
        this.updateValidity();
    },

    validateSpeed(event, type, index = null) {
        const value = event.target.value;
        const speedRegex = /^\d*\.?\d{0,1}$/;

        if (!speedRegex.test(value) && value !== "") {
            event.target.setCustomValidity(
                "Please enter speed in km/h (e.g., 12.5)",
            );
        } else {
            event.target.setCustomValidity("");
            if (speedRegex.test(value) && parseFloat(value) > 0) {
                const speedMS = parseFloat(value) / 3.6;
                this.updateSpeed(speedMS, type, index);
            }
        }
        this.updateValidity();
    },

    validateDistance(event, type, index = null) {
        const value = type === "single" ? this.singleDistance : event.target.value;
        const distance = parseFloat(value);
        const time = type === "single"
            ? this.workoutData.totalTime
            : this.workoutData.laps[index]?.time;

        if (!isNaN(distance) && distance > 0 && time > 0) {
            const speedMS = distance / time;
            this.updateSpeed(speedMS, type, index);
        }
    },

    updateValidity() {
        const paceRegex = /^(\d{1,2}):([0-5]\d)$/;
        const speedRegex = /^\d*\.?\d{0,1}$/;

        if (this.paceMode === "single") {
            const paceValid =
                this.singlePace && paceRegex.test(this.singlePace);
            return paceValid;
        } else {
            this.isValid = this.lapPaces.every((pace, index) => {
                const paceValid = pace === "" || paceRegex.test(pace);
                const speedValid =
                    this.lapSpeeds[index] === "" ||
                    speedRegex.test(this.lapSpeeds[index]);
                return paceValid && speedValid;
            });
        }
    },

    async adjustAndDownload() {
        if (this.paceMode === "single") {
            if (!this.singlePace && !this.singleSpeed) {
                this.showError("Please enter a target pace or taregt speed");
                return;
            }

            const options = {
                speed: this.singleSpeedMS,
                autolap: this.autoLapEnabled,
            };
            this.adjustPaces(options);
        } else {
            // Per-lap pace adjustment
            const invalidPaces = this.lapPaces.filter(
                (pace) => pace !== "" && !/^(\d{1,2}):([0-5]\d)$/.test(pace),
            );
            const invalidSpeeds = this.lapSpeeds.filter(
                (speed) => speed !== "" && !/^\d*\.?\d{0,1}$/.test(speed),
            );

            if (invalidPaces.length > 0 || invalidSpeeds.length > 0) {
                this.showError("Please correct invalid paces or speeds");
                return;
            }

            const options = {
                speeds: this.lapSpeedsMS,
                autolap: this.autoLapEnabled,
            };
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
