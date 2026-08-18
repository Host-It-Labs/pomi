package app.pomi.community.watch

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

class WearResourceParityTest {
    @Test
    fun everySupportedLocaleContainsEveryNonEmptyDefaultString() {
        val resourceRoot = findResourceRoot()
        val defaultEntries = parseStrings(File(resourceRoot, "values/strings.xml"))
        assertTrue("The default Wear strings catalog must not be empty", defaultEntries.isNotEmpty())

        val localeDirectories = resourceRoot.listFiles()
            ?.filter { it.isDirectory && (it.name == "values" || it.name.startsWith("values-")) }
            ?.filterNot { it.name == "values" }
            .orEmpty()
        assertEquals(
            "Expected all ten supported Wear locale directories",
            EXPECTED_LOCALES,
            localeDirectories.map { it.name }.toSet()
        )

        defaultEntries.forEach { (key, value) ->
            assertTrue("Invalid resource key: $key", key.matches(RESOURCE_KEY))
            assertFalse("Default resource $key is empty", value.isBlank())
        }

        localeDirectories.forEach { directory ->
            val entries = parseStrings(File(directory, "strings.xml"))
            defaultEntries.forEach { (key, _) ->
                assertTrue("${directory.name} is missing $key", entries.containsKey(key))
                assertFalse("${directory.name} has an empty $key", entries.getValue(key).isBlank())
            }
            entries.keys.forEach { key ->
                assertTrue("${directory.name} has an invalid resource key: $key", key.matches(RESOURCE_KEY))
                assertTrue("${directory.name} has an unknown resource key: $key", defaultEntries.containsKey(key))
            }
        }
    }

    private fun parseStrings(file: File): Map<String, String> {
        assertTrue("Missing Wear strings file: ${file.path}", file.isFile)
        val document = DocumentBuilderFactory.newInstance()
            .newDocumentBuilder()
            .parse(file)
        val result = linkedMapOf<String, String>()
        val resources = document.documentElement
        for (index in 0 until resources.childNodes.length) {
            val node = resources.childNodes.item(index)
            if (node.nodeType != org.w3c.dom.Node.ELEMENT_NODE) continue
            val name = node.attributes?.getNamedItem("name")?.nodeValue ?: continue
            val value = when (node.nodeName) {
                "string" -> node.textContent.trim()
                "plurals" -> buildString {
                    for (childIndex in 0 until node.childNodes.length) {
                        val child = node.childNodes.item(childIndex)
                        if (child.nodeType == org.w3c.dom.Node.ELEMENT_NODE && child.nodeName == "item") {
                            append(child.textContent.trim())
                        }
                    }
                }
                else -> continue
            }
            check(result.put(name, value) == null) { "Duplicate resource key $name in ${file.path}" }
        }
        return result
    }

    private fun findResourceRoot(): File {
        val workingDirectory = File(".").absoluteFile
        val candidates = listOf(
            File("src/main/res"),
            File("wear/src/main/res"),
            File("../wear/src/main/res"),
            File(workingDirectory, "src/main/res"),
            File(workingDirectory, "wear/src/main/res")
        )
        return candidates.firstOrNull { File(it, "values/strings.xml").isFile }
            ?: error("Unable to locate the Wear resource directory from ${workingDirectory.path}")
    }

    private companion object {
        val RESOURCE_KEY = Regex("[a-z][a-z0-9_]*")
        val EXPECTED_LOCALES = setOf(
            "values-ar",
            "values-bn",
            "values-es",
            "values-fr",
            "values-hi",
            "values-id",
            "values-pt-rBR",
            "values-ur",
            "values-zh-rCN"
        )
    }
}
