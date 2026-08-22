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
        targetSdk = 34
        versionCode = 1
        versionName = "0.0.1"
        manifestPlaceholders["usesCleartextTraffic"] = "false"
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

    kotlinOptions {
        jvmTarget = "1.8"
    }

    testOptions {
        unitTests.isIncludeAndroidResources = true
    }
}

dependencies {
    implementation("androidx.concurrent:concurrent-futures:1.2.0")
    implementation("com.google.guava:guava:33.2.1-android")
    implementation("androidx.wear.tiles:tiles:1.5.0")
    implementation("androidx.wear.protolayout:protolayout:1.3.0")
    implementation("androidx.wear.protolayout:protolayout-material:1.3.0")
    implementation("androidx.wear.protolayout:protolayout-expression:1.3.0")
    debugImplementation("androidx.wear.tiles:tiles-renderer:1.5.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("androidx.test:core:1.6.1")
    testImplementation("org.robolectric:robolectric:4.14.1")
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
