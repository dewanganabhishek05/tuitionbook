package com.tuitionbook.ocr

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

/**
 * On-device OCR. Images go straight to ML Kit; PDFs are rendered page by page (so scanned and
 * text PDFs are handled the same way) and each page is recognised. Returns every word with its
 * bounding box so the JS side can rebuild table rows.
 */
class TuitionOcrModule : Module() {
  private val maxPages = 30
  private val pdfTargetWidth = 1800

  override fun definition() = ModuleDefinition {
    Name("TuitionOcr")

    AsyncFunction("recognize") { uri: String, isPdf: Boolean, promise: Promise ->
      try {
        promise.resolve(if (isPdf) recognizePdf(uri) else listOf(recognizeImage(uri)))
      } catch (e: CodedException) {
        promise.reject(e)
      } catch (e: OutOfMemoryError) {
        promise.reject(CodedException("OUT_OF_MEMORY", "Not enough memory to read this file. Try a smaller photo.", e))
      } catch (e: Exception) {
        promise.reject(CodedException("OCR_FAILED", e.message ?: "Could not read the text", e))
      }
    }
  }

  private val context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private fun recognizeImage(uri: String): Map<String, Any> {
    val image = InputImage.fromFilePath(context, Uri.parse(uri))
    return toPage(run(image), image.width, image.height)
  }

  private fun recognizePdf(uri: String): List<Map<String, Any>> {
    val parsed = Uri.parse(uri)
    val fd: ParcelFileDescriptor = if (parsed.scheme == "content") {
      context.contentResolver.openFileDescriptor(parsed, "r")
    } else {
      ParcelFileDescriptor.open(File(parsed.path ?: uri), ParcelFileDescriptor.MODE_READ_ONLY)
    } ?: throw CodedException("FILE_NOT_FOUND", "Could not open the PDF", null)

    val pages = ArrayList<Map<String, Any>>()
    try {
      val renderer = try {
        PdfRenderer(fd)
      } catch (e: SecurityException) {
        throw CodedException("PDF_PROTECTED", "This PDF is password protected", e)
      }
      try {
        val count = minOf(renderer.pageCount, maxPages)
        for (i in 0 until count) {
          val bitmap = renderPage(renderer, i)
          try {
            pages.add(toPage(run(InputImage.fromBitmap(bitmap, 0)), bitmap.width, bitmap.height))
          } finally {
            bitmap.recycle()
          }
        }
      } finally {
        renderer.close()
      }
    } finally {
      fd.close()
    }
    return pages
  }

  private fun renderPage(renderer: PdfRenderer, index: Int): Bitmap {
    val page = renderer.openPage(index)
    try {
      var scale = pdfTargetWidth.toFloat() / page.width
      // keep very tall pages within a sane bitmap size
      val maxPixels = 9_000_000f
      val px = page.width * scale * page.height * scale
      if (px > maxPixels) scale *= Math.sqrt((maxPixels / px).toDouble()).toFloat()
      val bitmap = Bitmap.createBitmap(
        (page.width * scale).toInt().coerceAtLeast(1),
        (page.height * scale).toInt().coerceAtLeast(1),
        Bitmap.Config.ARGB_8888,
      )
      bitmap.eraseColor(Color.WHITE)
      page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
      return bitmap
    } finally {
      page.close()
    }
  }

  private fun run(image: InputImage): Text {
    val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    try {
      return Tasks.await(recognizer.process(image))
    } finally {
      recognizer.close()
    }
  }

  private fun toPage(text: Text, width: Int, height: Int): Map<String, Any> {
    val words = ArrayList<Map<String, Any>>()
    for (block in text.textBlocks) {
      for (line in block.lines) {
        for (el in line.elements) {
          val b = el.boundingBox ?: continue
          words.add(mapOf("text" to el.text, "left" to b.left, "top" to b.top, "right" to b.right, "bottom" to b.bottom))
        }
      }
    }
    return mapOf("width" to width, "height" to height, "words" to words)
  }
}
