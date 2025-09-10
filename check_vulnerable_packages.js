const { exec } = require('child_process');

const packages = [
    { name: "backslash", vulnerable_version: "0.2.1" },
    { name: "chalk", vulnerable_version: "5.6.1" },
    { name: "chalk-template", vulnerable_version: "1.1.1" },
    { name: "color-convert", vulnerable_version: "3.1.1" },
    { name: "color-name", vulnerable_version: "2.0.1" },
    { name: "color-string", vulnerable_version: "2.1.1" },
    { name: "wrap-ansi", vulnerable_version: "9.0.1" },
    { name: "supports-hyperlinks", vulnerable_version: "4.1.1" },
    { name: "strip-ansi", vulnerable_version: "7.1.1" },
    { name: "slice-ansi", vulnerable_version: "7.1.1" },
    { name: "simple-swizzle", vulnerable_version: "0.2.3" },
    { name: "is-arrayish", vulnerable_version: "0.3.3" },
    { name: "error-ex", vulnerable_version: "1.3.3" },
    { name: "ansi-regex", vulnerable_version: "6.2.1" },
    { name: "ansi-styles", vulnerable_version: "6.2.2" },
    { name: "supports-color", vulnerable_version: "10.2.1" },
    { name: "debug", vulnerable_version: "4.4.2" },
    { name: "color", vulnerable_version: "5.0.1" },
    { name: "has-ansi", vulnerable_version: "6.0.1" }
];

console.log("Checking for potentially vulnerable packages...");
console.log("------------------------------------------------");

function findVersions(packageName, dependencyTree) {
    let versions = new Set();
    if (dependencyTree.dependencies) {
        for (const depName in dependencyTree.dependencies) {
            const dep = dependencyTree.dependencies[depName];
            if (depName === packageName && dep.version) {
                versions.add(dep.version);
            }
            // Recursively search in sub-dependencies
            const subVersions = findVersions(packageName, dep);
            subVersions.forEach(v => versions.add(v));
        }
    }
    return versions;
}


packages.forEach(({ name, vulnerable_version }) => {
    exec(`npm ls ${name} --json`, (error, stdout, stderr) => {
        console.log(`Package: ${name}`);
        console.log(`Vulnerable version: ${vulnerable_version}`);

        if (error && !stdout) {
             // This can happen if the package is not found at all.
             // npm ls returns exit code 1 if the package is not in the tree.
             // We check for stdout because if the package is found, it will be there even with an error code.
            console.log("Installed version: Not found");
            console.log("------------------------------------------------");
            return;
        }

        try {
            const output = JSON.parse(stdout);
            const installedVersions = findVersions(name, output);

            if (installedVersions.size === 0) {
                console.log("Installed version: Not found");
            } else {
                console.log("Installed version(s):");
                installedVersions.forEach(version => {
                    console.log(`  - ${version}`);
                });
            }
        } catch (e) {
            // Fallback for cases where JSON parsing fails or stdout is not what we expect
            console.log("Installed version: Could not determine (parsing error)");
        }
        console.log("------------------------------------------------");
    });
});
