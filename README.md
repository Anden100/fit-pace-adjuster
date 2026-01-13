# FIT Pace Adjuster

[![Live Demo](https://img.shields.io/badge/Live%20Demo-Visit-blue)](https://anden100.github.io/fit-pace-adjuster/)

A lightweight web tool for adjusting paces in Garmin FIT files, specifically designed for treadmill running activities. This tool allows you to modify workout paces either as a single pace for the entire workout or individual paces per lap.

## Features

- **FIT File Support**: Works with Garmin FIT files from treadmill workouts
- **Flexible Pace Adjustment**: Choose between single pace for entire workout or per-lap pacing
- **Unit Support**: Supports both min/km and min/mile pace formats
- **Static Hosting Ready**: Optimized for deployment on GitHub Pages or any static host
- **Lightweight**: Built with Alpine.js and minimal dependencies

## How It Works

1. **Upload**: Drag and drop or select your .FIT file
2. **Review**: View workout summary and lap details
3. **Adjust**: Choose your preferred pace adjustment method
4. **Download**: Get your modified FIT file

## Technical Stack

- **Frontend Framework**: Alpine.js (7KB gzipped)
- **FIT Processing**: Local copy of Garmin FIT JavaScript SDK (with custom bug fixes)
- **Build Tool**: Vite
- **Deployment**: Static hosting (GitHub Pages ready)

## Development Setup

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd fit-pace-adjuster
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start development server:
   ```bash
   npm run dev
   ```

4. Build for production:
   ```bash
   npm run build
   ```

## Deployment

The built files in the `dist` folder can be deployed to any static hosting service:

### GitHub Pages

1. Push your built files to a `gh-pages` branch or use GitHub Actions
2. Enable GitHub Pages in your repository settings
3. Select the branch/folder containing your built files

### Manual Deployment

Simply upload the contents of the `dist` folder to your web server.

## Browser Support

- Chrome 80+
- Firefox 75+
- Safari 13+
- Edge 80+

## Limitations

- Currently optimized for treadmill running activities
- Complex workouts with varying intensities may need manual review
- Heart rate data and other metrics are preserved but not modified

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is open source. Please check the Garmin FIT SDK license for any restrictions on FIT file processing.

## Disclaimer

This tool modifies fitness data files. Always backup your original files before making changes. Use at your own risk.