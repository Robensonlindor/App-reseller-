plugins {
    id("com.android.application")
}

android {
    namespace = "io.playup.mobile"
    compileSdk = 34

    defaultConfig {
        applicationId = "io.playup.mobile"
        minSdk = 26
        targetSdk = 34
        versionCode = 20404
        versionName = "2.4.4"

        ndk {
            abiFilters += listOf("arm64-v8a", "armeabi-v7a")
        }
    }

    signingConfigs {
        create("release") {
            enableV1Signing = true
            enableV2Signing = true
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            isShrinkResources = false
            signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    // Pure Android SDK WebView + Activity — zero external native binary dependencies for universal ARM/ARM64 compatibility
}
