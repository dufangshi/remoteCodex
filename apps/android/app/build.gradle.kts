plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val repoRoot = rootProject.projectDir.parentFile.parentFile
val androidThreadWebDir = rootProject.layout.projectDirectory.dir("thread-web")
val androidThreadWebDistDir = androidThreadWebDir.dir("dist")
val androidThreadWebAssetsDir = layout.projectDirectory.dir("src/main/assets/thread-ui")

val buildAndroidThreadWeb by tasks.registering(Exec::class) {
    workingDir = repoRoot
    commandLine(
        "pnpm",
        "--dir",
        repoRoot.absolutePath,
        "--filter",
        "@remote-codex/android-thread-web",
        "build",
    )
    inputs.files(
        androidThreadWebDir.file("package.json"),
        androidThreadWebDir.file("tsconfig.json"),
        androidThreadWebDir.file("vite.config.ts"),
        androidThreadWebDir.file("index.html"),
    )
    inputs.dir(androidThreadWebDir.dir("src"))
    outputs.dir(androidThreadWebDistDir)
}

val copyAndroidThreadWebAssets by tasks.registering(Copy::class) {
    dependsOn(buildAndroidThreadWeb)
    doFirst {
        delete(androidThreadWebAssetsDir)
    }
    from(androidThreadWebDistDir)
    into(androidThreadWebAssetsDir)
}

android {
    namespace = "com.remotecodex.android"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.remotecodex.android"
        minSdk = 29
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        debug {
            val nativeThreadFallbackEnabled = providers
                .gradleProperty("remoteCodex.nativeThreadFallback")
                .orElse("false")
                .get()
            buildConfigField(
                "boolean",
                "REMOTE_CODEX_NATIVE_THREAD_DETAIL_FALLBACK",
                nativeThreadFallbackEnabled,
            )
        }
        release {
            isMinifyEnabled = false
            buildConfigField(
                "boolean",
                "REMOTE_CODEX_NATIVE_THREAD_DETAIL_FALLBACK",
                "false",
            )
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        buildConfig = true
        compose = true
    }

    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.14"
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.06.00")

    implementation(composeBom)
    implementation("androidx.activity:activity-compose:1.9.1")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    implementation("org.json:json:20240303")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    testImplementation("junit:junit:4.13.2")

    androidTestImplementation(composeBom)
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test:rules:1.7.0")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.7.0")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test.uiautomator:uiautomator:2.3.0")

    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}

tasks.named("preBuild") {
    dependsOn(copyAndroidThreadWebAssets)
}
