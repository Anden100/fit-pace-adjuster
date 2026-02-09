import Alpine from "alpinejs";
import { Decoder, Stream } from "./fitsdk";
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

    singlePace: "",
    singleSpeed: "",
    singleDistance: "",
    autoLapEnabled: true,
    lapDistances: [],
    lapPaces: [],
    lapSpeeds: [],

    // Processing state
    isProcessing: false,
    isValid: false,

    init() {
        this.lapPaces = [];
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

        console.log(this.workoutData.totalTime);
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

    speedToPace(speedKmh) {
        if (!speedKmh || speedKmh <= 0) return "";
        const paceMinPerKm = 60 / speedKmh;
        const minutes = Math.floor(paceMinPerKm);
        const seconds = Math.round((paceMinPerKm - minutes) * 60);
        return `${minutes}:${seconds.toString().padStart(2, "0")}`;
    },

    paceToSpeed(paceStr) {
        if (!paceStr) return "";
        const [minutes, seconds] = paceStr.split(":").map(Number);
        const totalMinutes = minutes + seconds / 60;
        return parseFloat((60 / totalMinutes).toFixed(1));
    },

    validatePace(event, type, index = null) {
        const value = event.target.value;
        const paceRegex = /^(\d{1,2}):([0-5]\d)$/;

        if (!paceRegex.test(value) && value !== "") {
            event.target.setCustomValidity("Please enter pace in format MM:SS");
        } else {
            event.target.setCustomValidity("");
            // Update distance when pace is valid
            if (
                type === "lap" &&
                paceRegex.test(value) &&
                this.workoutData.laps[index]
            ) {
                const paceSeconds = this.parsePace(value);
                const speed = 1000 / paceSeconds; // m/s
                const distance = speed * this.workoutData.laps[index].time;
                this.lapDistances[index] = Math.round(distance) || "";
            }
            // Auto-update speed when pace changes
            if (paceRegex.test(value) && type === "lap") {
                this.lapSpeeds[index] = this.paceToSpeed(value);
            }

            if (type == "single") {
                this.singleSpeed = this.paceToSpeed(value);
            }
        }
        this.updateValidity();
    },

    validateSpeed(event, type, index = null) {
        const value = event.target.value;
        const speedRegex = /^\d*\.?\d{0,1}$/; // Allow decimal with 1 decimal place

        if (!speedRegex.test(value) && value !== "") {
            event.target.setCustomValidity(
                "Please enter speed in km/h (e.g., 12.5)",
            );
        } else {
            if (type == "lap") {
                event.target.setCustomValidity("");
                // Auto-update pace when speed changes
                if (speedRegex.test(value) && parseFloat(value) > 0) {
                    this.lapPaces[index] = this.speedToPace(parseFloat(value));
                    // Update distance as well
                    if (this.workoutData.laps[index]) {
                        const speedMs = parseFloat(value) / 3.6; // Convert km/h to m/s
                        const distance =
                            speedMs * this.workoutData.laps[index].time;
                        this.lapDistances[index] = Math.round(distance) || "";
                    }
                }
            } else {
                this.singlePace = this.speedToPace(parseFloat(value));
            }
        }
        this.updateValidity();
    },

    updateValidity() {
        const paceRegex = /^(\d{1,2}):([0-5]\d)$/;
        const speedRegex = /^\d*\.?\d{0,1}$/;

        if (this.paceMode === "single") {
            const paceValid = this.singlePace && paceRegex.test(this.singlePace);
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

    updatePaceFromDistance(event, type, index = null) {
        if (type == "single") {
            const distance = parseFloat(this.singleDistance);
            const distanceKm = distance / 1000;
            const timeHours = this.workoutData.totalTime / 3600;
            const paceMinPerKm = (timeHours / distanceKm) * 60;
            const minutes = Math.floor(paceMinPerKm);
            const seconds = Math.round((paceMinPerKm - minutes) * 60);
            if (seconds >= 60) {
                this.singlePace = `${minutes + 1}:00`;
            } else {
                this.singlePace =
                    `${minutes}:${seconds.toString().padStart(2, "0")}`;
            }
            this.singleSpeed = this.paceToSpeed(this.singlePace);
        } else {
            const distance = parseFloat(this.lapDistances[index]);
            if (
                !isNaN(distance) &&
                distance > 0 &&
                this.workoutData.laps[index] &&
                this.workoutData.laps[index].time > 0
            ) {
                const timeHours = this.workoutData.laps[index].time / 3600;
                const distanceKm = distance / 1000;
                const paceMinPerKm = (timeHours / distanceKm) * 60;
                const minutes = Math.floor(paceMinPerKm);
                const seconds = Math.round((paceMinPerKm - minutes) * 60);
                if (seconds >= 60) {
                    this.lapPaces[index] = `${minutes + 1}:00`;
                } else {
                    this.lapPaces[index] =
                        `${minutes}:${seconds.toString().padStart(2, "0")}`;
                }
            }
        }
    },

    async adjustAndDownload() {
        if (this.paceMode === "single") {
            if (!this.singlePace && !this.singleSpeed) {
                this.showError("Please enter a target pace or taregt speed");
                return;
            }

            let targetSpeed = 0;
            if (this.singlePace) {
                const paceRegex = /^(\d{1,2}):([0-5]\d)$/;
                if (!paceRegex.test(this.singlePace)) {
                    this.showError("Please enter a valid pace in MM:SS format");
                    return;
                }

                const targetPaceSeconds = this.parsePace(this.singlePace);
                targetSpeed = 1000 / targetPaceSeconds; // m/s
            } else {
                targetSpeed = parseFloat(this.singleSpeed / 3.6);
            }

            const options = {
                speed: targetSpeed,
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

            const speeds = this.lapPaces.map((pace, index) => {
                // Use speed if available and valid, otherwise convert from pace
                if (
                    this.lapSpeeds[index] &&
                    parseFloat(this.lapSpeeds[index]) > 0
                ) {
                    return parseFloat(this.lapSpeeds[index]) / 3.6; // Convert km/h to m/s
                } else if (pace) {
                    return 1000 / this.parsePace(pace); // Convert pace to m/s
                }
                return 0;
            });

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
