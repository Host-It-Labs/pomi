import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlinx.kover")
}

android {
    namespace = "app.pomi.community.watch"
    compileSdk = 36

    defaultConfig {
        applicationId = "app.pomi.community.watch"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.0.1"
        manifestPlaceholders["usesCleartextTraffic"] = "false"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }

    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isMinifyEnabled = false
        }
        getByName("release") {
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    testOptions {
        unitTests.isIncludeAndroidResources = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_11
    }
}

dependencies {
    implementation("androidx.concurrent:concurrent-futures:1.3.0")
    implementation("com.google.guava:guava:33.7.1-android")
    implementation("androidx.wear.tiles:tiles:1.6.2")
    implementation("androidx.wear.protolayout:protolayout:1.4.2")
    implementation("androidx.wear.protolayout:protolayout-material:1.4.2")
    implementation("androidx.wear.protolayout:protolayout-expression:1.4.2")
    debugImplementation("androidx.wear.tiles:tiles-renderer:1.6.2")
    testImplementation("junit:junit:4.13.2")
    testImplementation("androidx.test:core:1.7.0")
    testImplementation("org.robolectric:robolectric:4.16.1")
}

kover {
    reports {
        filters {
            includes {
                classes(
                    "app.pomi.community.watch.Watch*Presentation*",
                    "app.pomi.community.watch.Watch*Projection*",
                    "app.pomi.community.watch.Watch*Reducer*",
                    "app.pomi.community.watch.Watch*Policy*",
                    "app.pomi.community.watch.Watch*Gate*"
                )
            }
        }
        verify {
            rule("Wear state and presentation coverage") {
                minBound(100)
            }
        }
    }
}
