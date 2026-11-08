plugins { id("com.android.application") }

android {
    namespace = "com.javier.asistenciaqr"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.javier.asistenciaqr"
        minSdk = 26
        targetSdk = 34
        versionCode = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
        versionName = "1.0." + (System.getenv("GITHUB_RUN_NUMBER") ?: "0")
    }

    // Llave fija del proyecto: así cada APK nueva se instala encima de la anterior sin desinstalar.
    signingConfigs {
        create("app") {
            storeFile = file("../asistencia-qr.keystore")
            storePassword = "asistenciaqr"
            keyAlias = "asistenciaqr"
            keyPassword = "asistenciaqr"
        }
    }
    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("app")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
