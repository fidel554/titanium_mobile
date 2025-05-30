# requirements.txt: dash plotly pandas requests

import dash
from dash import dcc, html
import plotly.graph_objs as go
import pandas as pd
import requests

# Replace with your Alpha Vantage API key
API_KEY = 'YOUR_API_KEY'
BASE_URL = 'https://www.alphavantage.co/query'

def fetch_fx_data(symbol='EURUSD', interval='60min'):
    params = {
        'function': 'FX_INTRADAY',
        'from_symbol': symbol[:3],
        'to_symbol': symbol[3:],
        'interval': interval,
        'apikey': API_KEY,
        'outputsize': 'compact'
    }
    r = requests.get(BASE_URL, params=params)
    data = r.json()
    key = f'Time Series FX ({interval})'
    df = pd.DataFrame.from_dict(data[key], orient='index')
    df = df.astype(float)
    df.index = pd.to_datetime(df.index)
    df.sort_index(inplace=True)
    return df

df = fetch_fx_data()

app = dash.Dash(__name__)
app.layout = html.Div([
    html.H1('Forex Chart Analyzer'),
    dcc.Graph(
        id='forex-chart',
        figure={
            'data': [
                go.Candlestick(
                    x=df.index,
                    open=df['1. open'],
                    high=df['2. high'],
                    low=df['3. low'],
                    close=df['4. close'],
                    name='EUR/USD'
                )
            ],
            'layout': go.Layout(title='EUR/USD Forex Chart')
        }
    )
])

if __name__ == '__main__':
    app.run_server(debug=True)'use strict';

const path = require('path');
const fs = require('fs-extra');
const utils = require('../utils');
const { spawn } = require('child_process'); // eslint-disable-line security/detect-child-process
const copyFile = utils.copyFile;
const copyFiles = utils.copyFiles;
const copyAndModifyFile = utils.copyAndModifyFile;
const globCopy = utils.globCopy;

// Determine if we're running on a Windows machine.
const isWindows = (process.platform === 'win32');

const ROOT_DIR = path.join(__dirname, '..', '..', '..');
const TITANIUM_ANDROID_PATH = path.join(__dirname, '..', '..', '..', 'android');
const DIST_ANDROID_PATH = path.join(__dirname, '..', '..', '..', 'dist', 'android');
const GRADLEW_FILE_PATH = path.join(TITANIUM_ANDROID_PATH, isWindows ? 'gradlew.bat' : 'gradlew');
// On CI server, use plain output to avoid nasty progress bars filling up logs
// But on local dev, use the nice UI
const GRADLE_CONSOLE_MODE = (process.env.TRAVIS || process.env.JENKINS || process.env.CI) ? 'plain' : 'rich';
const V8_STRING_VERSION_REGEXP = /(\d+)\.(\d+)\.\d+\.\d+/;

class Android {
	/**
	 * @param {Object} options options object
	 * @param {String} options.androidSdk path to the Android SDK to build with
	 * @param {String} options.androidNdk path to the Andorid NDK to build with
	 * @param {String} options.sdkVersion version of Titanium SDK
	 * @param {String} options.versionTag version of the Titanium SDK package folder/zip
	 * @param {String} options.gitHash SHA of Titanium SDK HEAD
	 * @param {string} options.timestamp Value injected for Ti.buildDate
	 * @constructor
	 */
	constructor (options) {
		this.androidSdk = options.androidSdk;
		this.androidNdk = options.androidNdk;
		this.sdkVersion = options.sdkVersion;
		this.versionTag = options.versionTag;
		this.gitHash = options.gitHash;
		this.timestamp = options.timestamp;
	}

	babelOptions() {
		const v8Version = require(path.join(ROOT_DIR, 'android', 'package.json')).v8.version; // eslint-disable-line security/detect-non-literal-require
		const v8VersionGroup = v8Version.match(V8_STRING_VERSION_REGEXP);
		const version = parseInt(v8VersionGroup[1] + v8VersionGroup[2]);

		return {
			targets: {
				chrome: version
			},
			transform: {
				platform: 'android',
				Ti: {
					version: this.sdkVersion,
					buildHash: this.gitHash,
					buildDate: this.timestamp,
					Platform: {
						osname: 'android',
						name: 'android',
						runtime: 'v8',
					},
					Filesystem: {
						lineEnding: '\n',
						separator: '/',
					},
				},
			},
		};
	}

	async clean() {
		// Clean all Titanium Android projects.
		await this.runGradleTask('clean');
	}

	async build() {
		// Set up the build system to fail if unable to generate a V8 snapshot. Needed for fast app startup times.
		// Note: Allow system to override this behavior if environment variable is already defined.
		if (typeof process.env.TI_SDK_BUILD_REQUIRES_V8_SNAPSHOTS === 'undefined') {
			process.env.TI_SDK_BUILD_REQUIRES_V8_SNAPSHOTS = '1';
		}

		// Build the "titanium" library project only.
		process.env.TI_SDK_BUILD_VERSION = this.sdkVersion;
		process.env.TI_SDK_BUILD_GIT_HASH = this.gitHash;
		process.env.TI_SDK_BUILD_TIMESTAMP = this.timestamp;
		process.env.TI_SDK_VERSION_TAG = this.versionTag;
		await this.runGradleTask(':titanium:assembleRelease');
	}

	async package(packager) {
		console.log('Packaging Android platform...');

		// Create the Android destination directory to be zipped up.
		const ZIP_ANDROID_PATH = path.join(packager.zipSDKDir, 'android');
		await fs.mkdirs(ZIP_ANDROID_PATH);

		// Generate a maven repo directory structure and dependencies POM file for last built Titanium AAR library.
		process.env.TI_SDK_BUILD_VERSION = this.sdkVersion;
		process.env.TI_SDK_BUILD_GIT_HASH = this.gitHash;
		process.env.TI_SDK_VERSION_TAG = this.versionTag;
		await this.runGradleTask(':titanium:publish');

		// Copy the above created maven directory tree to the destination.
		await copyFile(path.join(TITANIUM_ANDROID_PATH, 'titanium', 'build', 'outputs'), ZIP_ANDROID_PATH, 'm2repository');

		// Copy the Android "package.json" file. Replace its "__VERSION__" with given version.
		await copyAndModifyFile(TITANIUM_ANDROID_PATH, ZIP_ANDROID_PATH, 'package.json', { __VERSION__: this.sdkVersion });

		// Copy Titanium's API/proxy bindings JSON file to the destination.
		// This is needed to do native module builds. Provides core APIs to help generate module proxy bindings.
		await copyFile(DIST_ANDROID_PATH, ZIP_ANDROID_PATH, 'titanium.bindings.json');

		// Copy the Andoid "cli" and "templates" folders.
		await copyFiles(TITANIUM_ANDROID_PATH, ZIP_ANDROID_PATH, [ 'cli', 'templates' ]);

		// Create a "gradle" template directory at destination and copy same gradle files used to build Titanium.
		// Note: This way we build apps/modules with same gradle version we use to build our own library.
		const ZIP_TEMPLATE_GRADLE_PATH = path.join(ZIP_ANDROID_PATH, 'templates', 'gradle');
		await fs.mkdirs(ZIP_TEMPLATE_GRADLE_PATH);
		await copyFiles(TITANIUM_ANDROID_PATH, ZIP_TEMPLATE_GRADLE_PATH, [
			'gradle',       // Directory tree containing the gradle library and properties file.
			'gradlew',      // Shell script used to run gradle on Mac/Linux.
			'gradlew.bat'   // Batch file used to run gradle on Windows.
		]);

		// Copy Titanium's and V8's C/C++ header files to the destination.
		// This is needed to compile the C/C++ code generated for modules and hyperloop.
		const ZIP_HEADER_INCLUDE_PATH = path.join(ZIP_ANDROID_PATH, 'native', 'include');
		await fs.mkdirs(ZIP_HEADER_INCLUDE_PATH);
		await globCopy('**/*.h', path.join(TITANIUM_ANDROID_PATH, 'runtime', 'v8', 'src', 'native'), ZIP_HEADER_INCLUDE_PATH);
		await globCopy('**/*.h', path.join(TITANIUM_ANDROID_PATH, 'runtime', 'v8', 'generated'), ZIP_HEADER_INCLUDE_PATH);
		const v8Props = require(path.join(TITANIUM_ANDROID_PATH, 'package.json')).v8; // eslint-disable-line security/detect-non-literal-require
		const LIBV8_INCLUDE_PATH = path.join(DIST_ANDROID_PATH, 'libv8', v8Props.version, v8Props.mode, 'include');
		await globCopy('**/*.h', LIBV8_INCLUDE_PATH, ZIP_HEADER_INCLUDE_PATH);

		// Copy our C/C++ "*.so" libraries to the destination.
		const TITANIUM_NATIVE_LIBS_PATH = path.join(TITANIUM_ANDROID_PATH, 'titanium', 'build', 'outputs', 'jniLibs');
		const ZIP_NATIVE_LIBS_PATH = path.join(ZIP_ANDROID_PATH, 'native', 'libs');
		await fs.mkdirs(ZIP_NATIVE_LIBS_PATH);
		await fs.copy(TITANIUM_NATIVE_LIBS_PATH, ZIP_NATIVE_LIBS_PATH, {
			filter: async (filePath) => {
				if ((await fs.stat(filePath)).isDirectory()) {
					// Copy all subdirectories.
					return true;
				} else if (filePath.toLowerCase().endsWith('.so')) {
					// Copy all "*.so" files.
					return true;
				}
				return false;
			}
		});

		// Copy our Java annotation processor library to destination.
		// This generates C/C++ interop code between JavaScript and the Java APIs which have these annotations.
		await copyFile(path.join(TITANIUM_ANDROID_PATH, 'kroll-apt', 'build', 'libs'), ZIP_ANDROID_PATH, 'kroll-apt.jar');
	}

	async runGradleTask(task, args) {
		// Create "local.properties" file which tells gradle where to find the Android SDK/NDK directories.
		await createLocalPropertiesFile(this.androidSdk, this.androidNdk);

		// Run the given gradle task.
		const newArgs = [ task ];
		if (Array.isArray(args)) {
			newArgs.push(...args);
		} else {
			newArgs.push('--console', GRADLE_CONSOLE_MODE, '--warning-mode', 'all');
		}
		await gradlew(newArgs);
	}
}

async function gradlew(args) {
	await new Promise((resolve, reject) => {
		const childProcess = spawn(GRADLEW_FILE_PATH, args, { cwd: TITANIUM_ANDROID_PATH, stdio: 'inherit' });
		childProcess.on('error', reject);
		childProcess.on('exit', (exitCode) => {
			if (exitCode === 0) {
				resolve();
			} else {
				reject(`"gradlew" tool returned exit code: ${exitCode}`);
			}
		});
	});
}

async function createLocalPropertiesFile(sdkPath, ndkPath) {
	// The "local.properties" file must be in the root gradle project directory.
	const fileName = 'local.properties';
	const filePath = path.join(TITANIUM_ANDROID_PATH, fileName);

	// Set up an array of Android SDK directory paths to do an existence check on.
	const sdkTestPaths = [
		sdkPath,                        // Prefer given argument's path 1st if provided and it exists.
		process.env.ANDROID_SDK,        // Titanium's preferred environment variable for setting the path.
		process.env.ANDROID_HOME,       // Google's deprecated variable. Must take priority over ANDROID_SDK_ROOT.
		process.env.ANDROID_SDK_ROOT    // Google's officially supported environment variable.
	];
	if (isWindows) {
		// Add Windows specific paths.
		if (process.env.LOCALAPPDATA) {
			// Android Studio's default install location on Windows.
			sdkTestPaths.push(path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk'));
		}
		sdkTestPaths.push(
			'C:\\android-sdk',
			'C:\\android',
		);
		if (process.env.ProgramFiles) {
			sdkTestPaths.push(path.join(process.env.ProgramFiles, 'android-sdk'));
			sdkTestPaths.push(path.join(process.env.ProgramFiles, 'android'));
		}
		const programFiles32BitPath = process.env['ProgramFiles(x86)'];
		if (programFiles32BitPath) {
			sdkTestPaths.push(path.join(programFiles32BitPath, 'android-sdk'));
			sdkTestPaths.push(path.join(programFiles32BitPath, 'android'));
		}
	} else {
		// Add MacOS/Linux specific paths.
		if (process.env.HOME) {
			// Android Studio's default install location on MacOS.
			sdkTestPaths.push(path.join(process.env.HOME, 'Library', 'Android', 'sdk'));

			// Android Studio's default install location on Linux.
			sdkTestPaths.push(path.join(process.env.HOME, 'Android', 'sdk'));
		}
		sdkTestPaths.push(
			'/opt/android',
			'/opt/android-sdk',
			'/usr/android',
			'/usr/android-sdk'
		);
	}

	// Use the 1st existing SDK path configured in the array above.
	sdkPath = null;
	for (const nextPath of sdkTestPaths) {
		if (nextPath && (await fs.exists(nextPath))) {
			sdkPath = nextPath;
			break;
		}
	}
	if (!sdkPath) {
		const message = 'Failed to find Android SDK directory path.';
		if (await fs.exists(filePath)) {
			console.warn(`Warning: ${message} Will use last generated "${fileName}" file.`);
			return;
		} else {
			throw new Error(message);
		}
	}

	// Set up an array of Android NDK directory paths to do an existence check on.
	const ndkSideBySidePath = path.join(sdkPath, 'ndk');
	const ndkTestPaths = [
		ndkPath,                            // Prefer given argument's path 1st if provided and it exists.
		process.env.ANDROID_NDK,            // Titanium's preferred environment variable for setting the path.
		process.env.ANDROID_NDK_HOME,       // Google's officially supported environment variable.
		ndkSideBySidePath,                  // Google installs multiple NDK versions under Android SDK folder as of 2019.
		path.join(sdkPath, 'ndk-bundle')    // Google installed only one NDK version under Android SDK before 2019.
	];

	// Use the 1st existing NDK path configured in the array above.
	ndkPath = null;
	for (const nextPath of ndkTestPaths) {
		if (nextPath && (await fs.exists(nextPath))) {
			if (nextPath === ndkSideBySidePath) {
				// We've found an NDK side-by-side directory which contains folders with version names.
				// Fetch all folders, sort them by version string, and choose the newest versioned folder.
				const fileNames = await fs.readdir(nextPath);
				fileNames.sort(versionStringSortComparer);
				for (let index = fileNames.length - 1; index >= 0; index--) {
					const ndkVersionPath = path.join(nextPath, fileNames[index]);
					if ((await fs.stat(ndkVersionPath)).isDirectory()) {
						ndkPath = ndkVersionPath;
						break;
					}
				}
			} else {
				// NDK directory path exists. Select it.
				ndkPath = nextPath;
			}
			if (ndkPath) {
				break;
			}
		}
	}

	// Create a "local.properties" file under Titanium's root "android" directory.
	// This is required by the Android gradle plugin or else it will fail to build.
	const fileLines = [
		'# This file was generated by Titanium\'s build tools.',
		'sdk.dir=' + sdkPath.replace(/\\/g, '\\\\')
	];
	if (ndkPath) {
		fileLines.push('ndk.dir=' + ndkPath.replace(/\\/g, '\\\\'));
	}
	await fs.writeFile(filePath, fileLines.join('\n') + '\n');
}

function versionStringSortComparer(element1, element2) {
	// Check if the references match. (This is an optimization.)
	// eslint-disable-next-line eqeqeq
	if (element1 == element2) {
		return 0;
	}

	// Compare element types. String types are always greater than non-string types.
	const isElement1String = (typeof element1 === 'string');
	const isElement2String = (typeof element2 === 'string');
	if (isElement1String && !isElement2String) {
		return 1;
	} else if (!isElement1String && isElement2String) {
		return -1;
	} else if (!isElement1String && !isElement2String) {
		return 0;
	}

	// Split version strings into components. Example: '1.2.3' -> ['1', '2', '3']
	// If there is version component lenght mismatch, then pad the rest with zeros.
	const version1Components = element1.split('.');
	const version2Components = element2.split('.');
	const componentLengthDelta = version1Components.length - version2Components.length;
	if (componentLengthDelta > 0) {
		version2Components.push(...Array(componentLengthDelta).fill('0'));
	} else if (componentLengthDelta < 0) {
		version1Components.push(...Array(-componentLengthDelta).fill('0'));
	}

	// Compare the 2 given version strings by their numeric components.
	for (let index = 0; index < version1Components.length; index++) {
		let value1 = Number.parseInt(version1Components[index], 10);
		if (Number.isNaN(value1)) {
			value1 = 0;
		}
		let value2 = Number.parseInt(version2Components[index], 10);
		if (Number.isNaN(value2)) {
			value2 = 0;
		}
		const valueDelta = value1 - value2;
		if (valueDelta !== 0) {
			return valueDelta;
		}
	}
	return 0;
}

module.exports = Android;
