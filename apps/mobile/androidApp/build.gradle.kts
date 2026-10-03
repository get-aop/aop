import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.parcelize)
}

/**
 * The release key never lives in the repository. Its properties file (storeFile, storePassword,
 * keyAlias, keyPassword) is read from AOP_MOBILE_SIGNING_PROPERTIES, else
 * ~/.aop-mobile/keystore.properties; without one, a release build is left unsigned and cannot be
 * installed.
 */
val signing: Properties = Properties().apply {
    val path = System.getenv("AOP_MOBILE_SIGNING_PROPERTIES")
        ?: "${System.getProperty("user.home")}/.aop-mobile/keystore.properties"
    val file = File(path)
    if (file.exists()) file.inputStream().use(::load)
}

android {
    namespace = "com.getaop.mobile"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.getaop.mobile"
        minSdk = 26
        // 36, not 37: Android 17's local-network permission may count Tailscale's addresses
        // as local, which is untested. Play requires 37 only from August 2027.
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }

    signingConfigs {
        create("release") {
            signing.getProperty("storeFile")?.let { storeFile = file(it) }
            storePassword = signing.getProperty("storePassword")
            keyAlias = signing.getProperty("keyAlias")
            keyPassword = signing.getProperty("keyPassword")
            enableV2Signing = true
            enableV3Signing = true
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (signing.getProperty("storeFile") != null) signingConfig = signingConfigs.getByName("release")
        }
    }

    buildFeatures { compose = true }

    lint {
        warningsAsErrors = false
        abortOnError = true
        checkReleaseBuilds = false
    }
}

base.archivesName.set("aop-mobile")

dependencies {
    implementation(project(":shared"))
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.compose.material3.adaptive)
    implementation(libs.compose.material3.adaptive.layout)
    implementation(libs.compose.material3.adaptive.navigation)
    implementation(libs.compose.material.icons)
    implementation(libs.activity.compose)
    implementation(libs.lifecycle.viewmodel.compose)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.lifecycle.process)
    implementation(libs.core.ktx)
    implementation(libs.datastore.preferences)
    implementation(libs.window)
    implementation(libs.camerax.camera2)
    implementation(libs.camerax.lifecycle)
    implementation(libs.camerax.view)
    implementation(libs.zxing.core)
    implementation(libs.ktor.client.core)
    implementation(libs.ktor.client.okhttp)
    implementation(libs.kotlinx.coroutines.android)
    debugImplementation(libs.compose.ui.tooling)
    testImplementation(libs.junit)
    testImplementation(kotlin("test-junit"))
}
