/**
 * Builds the signed Android APK and stages it for the web download.
 *
 * The whole toolchain the CI machine won't have is discovered here rather than
 * assumed on PATH: Android Studio ships a JDK, and the SDK sits in the usual
 * per-user location. If neither is found the script says what's missing instead
 * of failing three layers down inside Gradle.
 *
 * Steps: web build -> cap copy -> gradle assembleRelease -> copy into public.
 * Run with: npm run build:apk
 */
import { execFileSync } from 'node:child_process'
import { existsSync, copyFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const isWin = process.platform === 'win32'

/** First existing path from the candidates, or null. */
const firstOf = (paths) => paths.find((p) => p && existsSync(p)) ?? null

const javaHome =
  process.env.JAVA_HOME ??
  firstOf([
    join(process.env.ProgramFiles ?? 'C:/Program Files', 'Android/Android Studio/jbr'),
    '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
    join(homedir(), 'Android/Android Studio/jbr'),
  ])

const androidHome =
  process.env.ANDROID_HOME ??
  process.env.ANDROID_SDK_ROOT ??
  firstOf([
    join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData/Local'), 'Android/Sdk'),
    join(homedir(), 'Library/Android/sdk'),
    join(homedir(), 'Android/Sdk'),
  ])

if (!javaHome) {
  console.error('No JDK found. Install Android Studio, or set JAVA_HOME.')
  process.exit(1)
}
if (!androidHome) {
  console.error('No Android SDK found. Install it via Android Studio, or set ANDROID_HOME.')
  process.exit(1)
}
if (!existsSync(join(ROOT, 'android'))) {
  console.error('The android/ project is missing. Run `npx cap add android` first.')
  process.exit(1)
}

const env = { ...process.env, JAVA_HOME: javaHome, ANDROID_HOME: androidHome }
const run = (cmd, args, cwd = ROOT) =>
  execFileSync(cmd, args, { cwd, env, stdio: 'inherit', shell: isWin })

console.log('› building web assets')
run('npm', ['run', 'build'])

console.log('› copying into the native project')
run('npx', ['cap', 'copy', 'android'])

console.log('› gradle assembleRelease (first run downloads Gradle, be patient)')
run(isWin ? 'gradlew.bat' : './gradlew', ['assembleRelease', '--no-daemon'], join(ROOT, 'android'))

const outDir = join(ROOT, 'android/app/build/outputs/apk/release')
const apk = readdirSync(outDir).find((f) => f.endsWith('.apk') && !f.includes('unsigned'))
if (!apk) {
  console.error('Build finished but no signed APK was produced.')
  process.exit(1)
}
const dest = join(ROOT, 'public/gigil.apk')
copyFileSync(join(outDir, apk), dest)
console.log(`✓ public/gigil.apk  ${(statSync(dest).size / 1048576).toFixed(1)} MB`)
