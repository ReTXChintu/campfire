allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}
subprojects {
    project.evaluationDependsOn(":app")
}

// Forces every Android library module (i.e. every plugin, not just our own app module) to compile
// against at least SDK 36 — file_picker's own bundled Android module still declares compileSdk 34,
// which conflicts with flutter_plugin_android_lifecycle (pulled in transitively by several plugins)
// now requiring 36+. This is the standard workaround for a lagging plugin's declared compileSdk;
// it doesn't change any plugin's actual behavior, just what SDK version its code is checked against.
fun Project.forceMinCompileSdk36() {
    extensions.findByType(com.android.build.gradle.BaseExtension::class.java)?.let { android ->
        val current = android.compileSdkVersion?.removePrefix("android-")?.toIntOrNull() ?: 0
        if (current < 36) {
            android.compileSdkVersion(36)
        }
    }
}

subprojects {
    // `:app` is already evaluated by this point (the evaluationDependsOn(":app") block above
    // forces that) — afterEvaluate throws on an already-evaluated project, so apply directly for
    // it and defer for every other (not-yet-evaluated) subproject/plugin module as usual.
    if (state.executed) {
        forceMinCompileSdk36()
    } else {
        afterEvaluate { forceMinCompileSdk36() }
    }
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
