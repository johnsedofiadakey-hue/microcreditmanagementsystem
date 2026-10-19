plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "com.stormglide.susu.agent"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.stormglide.susu.agent"
        minSdk = 26
        targetSdk = 37
        versionCode = 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".dev"
            // Local Firebase Emulator Suite. 10.0.2.2 is the host machine from the Android emulator.
            buildConfigField("boolean", "USE_EMULATORS", "true")
            buildConfigField("String", "EMULATOR_HOST", "\"10.0.2.2\"")
            buildConfigField("String", "FIREBASE_PROJECT_ID", "\"demo-susu\"")
            buildConfigField("String", "FIREBASE_APP_ID", "\"1:000000000000:android:0000000000000000\"")
            buildConfigField("String", "FIREBASE_API_KEY", "\"demo-api-key\"")
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            buildConfigField("boolean", "USE_EMULATORS", "false")
            buildConfigField("String", "EMULATOR_HOST", "\"\"")
            // Real values come from the per-environment Firebase app (susu-staging / susu-prod) at release time.
            buildConfigField("String", "FIREBASE_PROJECT_ID", "\"${providers.gradleProperty("susu.firebase.projectId").getOrElse("susu-staging")}\"")
            buildConfigField("String", "FIREBASE_APP_ID", "\"${providers.gradleProperty("susu.firebase.appId").getOrElse("")}\"")
            buildConfigField("String", "FIREBASE_API_KEY", "\"${providers.gradleProperty("susu.firebase.apiKey").getOrElse("")}\"")
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

kotlin {
    // Target Java 17 bytecode from whichever JDK 17+ runs Gradle (no toolchain download needed).
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

// Satoshi is licensed for embedding, not redistribution, so it isn't committed. Fail early with the fix.
val checkSatoshi by tasks.registering {
    val fonts = listOf("satoshi_medium", "satoshi_bold", "satoshi_black").map { layout.projectDirectory.file("src/main/res/font/$it.ttf").asFile }
    doLast {
        val missing = fonts.filterNot { it.exists() }
        if (missing.isNotEmpty()) {
            throw GradleException("Satoshi font files are missing (${missing.joinToString { it.name }}). Run apps/agent-android/scripts/fetch-satoshi.sh once.")
        }
    }
}
tasks.named("preBuild") { dependsOn(checkSatoshi) }

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.datastore.preferences)
    implementation(libs.androidx.biometric)
    implementation(libs.androidx.fragment)
    implementation(libs.androidx.work.runtime)

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons)
    debugImplementation(libs.compose.ui.tooling)

    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.auth)
    implementation(libs.firebase.firestore)
    implementation(libs.firebase.appcheck.playintegrity)
    implementation(libs.kotlinx.coroutines.play.services)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    // Android's org.json is a stub in JVM unit tests; the real library lets RefusedWritesJson be tested.
    testImplementation(libs.org.json)
}
