document.addEventListener('DOMContentLoaded', () => {
    // --- Referencias al DOM ---
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('image-upload');
    const imageElement = document.getElementById('image-to-crop');
    const finalImagePreview = document.getElementById('final-image');
    
    // Contenedores de pasos
    const uploadStep = document.getElementById('upload-step');
    const editorStep = document.getElementById('editor-step');
    const resultStep = document.getElementById('result-step');
    
    // Botones
    const btnCancel = document.getElementById('btn-cancel');
    const btnProcess = document.getElementById('btn-process');
    const btnDownload = document.getElementById('btn-download');
    const btnReset = document.getElementById('btn-reset');
    
    // Loader
    const loadingScreen = document.getElementById('loading');
    const loadingText = document.getElementById('loading-text');

    // Variables de estado
    let cropper = null;
    const TARGET_WIDTH = 240;
    const TARGET_HEIGHT = 288;
    const MIN_SIZE_KB = 4;
    const MAX_SIZE_KB = 50;
    const TARGET_DPI = 300; // Estándar de impresión

    // --- Manejo de Drag & Drop ---
    
    // Prevenir comportamientos por defecto
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    // Estilos al arrastrar
    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, highlight, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, unhighlight, false);
    });

    function highlight() {
        dropZone.classList.add('border-unsa-600', 'bg-blue-50');
    }

    function unhighlight() {
        dropZone.classList.remove('border-unsa-600', 'bg-blue-50');
    }

    // Manejar archivo soltado
    dropZone.addEventListener('drop', handleDrop, false);

    function handleDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;
        handleFiles(files);
    }

    // Manejar selección por click
    fileInput.addEventListener('change', function() {
        handleFiles(this.files);
    });

    // --- Lógica Principal ---

    function handleFiles(files) {
        if (files.length === 0) return;
        
        const file = files[0];
        
        // Validar tipo de archivo
        if (!file.type.startsWith('image/')) {
            alert('Por favor, sube un archivo de imagen válido (JPG, PNG).');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            // Mostrar editor
            uploadStep.classList.add('hidden');
            editorStep.classList.remove('hidden');
            resultStep.classList.add('hidden');

            // Cargar imagen en elemento
            imageElement.src = e.target.result;

            // Inicializar CropperJS
            if (cropper) {
                cropper.destroy();
            }
            
            cropper = new Cropper(imageElement, {
                aspectRatio: TARGET_WIDTH / TARGET_HEIGHT, // 5:6 (0.8333)
                viewMode: 1, // Restringir el cuadro de recorte dentro del canvas
                dragMode: 'move',
                autoCropArea: 0.8,
                responsive: true,
                background: false, // Fondo oscuro para mejor contraste
                minContainerWidth: 300,
                minContainerHeight: 300,
            });
        };
        reader.readAsDataURL(file);
    }

    // Botón Cancelar
    btnCancel.addEventListener('click', () => {
        resetApp();
    });

    // Botón Reiniciar (desde resultados)
    btnReset.addEventListener('click', () => {
        resetApp();
    });

    function resetApp() {
        if (cropper) {
            cropper.destroy();
            cropper = null;
        }
        imageElement.src = '';
        fileInput.value = ''; // Reset input
        
        uploadStep.classList.remove('hidden');
        editorStep.classList.add('hidden');
        resultStep.classList.add('hidden');
    }

    // --- Procesamiento de Imagen ---

    btnProcess.addEventListener('click', async () => {
        if (!cropper) return;

        showLoading(true, 'Redimensionando y comprimiendo...');

        // 1. Obtener canvas recortado con dimensiones exactas
        const canvas = cropper.getCroppedCanvas({
            width: TARGET_WIDTH,
            height: TARGET_HEIGHT,
            fillColor: '#fff', 
            imageSmoothingEnabled: true,
            imageSmoothingQuality: 'high',
        });

        if (!canvas) {
            showLoading(false);
            alert('Error al recortar la imagen.');
            return;
        }

        // 2. Proceso Iterativo de Compresión
        try {
            // Buscamos el blob ideal
            const processedBlob = await compressImageToTargetSize(canvas);
            
            // 3. Inyectar Metadatos DPI (300 DPI)
            const reader = new FileReader();
            reader.readAsDataURL(processedBlob);
            
            reader.onloadend = () => {
                const base64data = reader.result;
                
                try {
                    // Inserción de metadatos EXIF para DPI
                    const finalBase64 = insertDpiMetadata(base64data, TARGET_DPI);
                    // Mostrar resultados
                    displayResults(finalBase64, processedBlob.size);
                } catch (e) {
                    console.error("Error en metadatos:", e);
                    // Fallback sin metadatos si falla piexif
                    displayResults(base64data, processedBlob.size);
                }
                showLoading(false);
            };

        } catch (error) {
            showLoading(false);
            console.error(error);
            alert(error.message || 'Error al procesar la imagen.');
        }
    });

    /**
     * Comprime el canvas iterativamente hasta encontrar un tamaño válido en KB.
     */
    async function compressImageToTargetSize(canvas) {
        let quality = 0.95; 
        let minQuality = 0.1; 
        let step = 0.05; 
        let blob = null;
        let found = false;

        // Bucle para reducir tamaño si es > 50KB
        while (quality >= minQuality) {
            blob = await getCanvasBlob(canvas, quality);
            const sizeKB = blob.size / 1024;
            
            console.log(`Compresión: Calidad ${(quality*100).toFixed(0)}% -> ${sizeKB.toFixed(2)} KB`);

            if (sizeKB <= MAX_SIZE_KB && sizeKB >= MIN_SIZE_KB) {
                found = true;
                break;
            }
            
            // Si es menor que el mínimo, es demasiado simple/pequeña
            if (sizeKB < MIN_SIZE_KB) {
                if (quality >= 0.9) throw new Error("La imagen es demasiado simple/pequeña (< 4KB).");
                // Si bajamos calidad y nos pasamos de pequeños, nos quedamos con la anterior (aunque sea > 50KB? No, eso fallaría las reglas)
                // En este caso estricto, paramos.
                break; 
            }

            quality -= step;
        }
        
        if (!blob) throw new Error("Error generando imagen.");

        const finalSize = blob.size / 1024;
        if (finalSize > MAX_SIZE_KB) {
             throw new Error(`No se pudo comprimir a menos de 50KB (Actual: ${finalSize.toFixed(2)} KB). Intenta recortar menos fondo o usar otra foto.`);
        }
        if (finalSize < MIN_SIZE_KB) {
             throw new Error(`La imagen es demasiado ligera (${finalSize.toFixed(2)} KB). Requisito mínimo 4KB.`);
        }

        return blob;
    }

    /**
     * Wrapper Promesa para canvas.toBlob
     */
    function getCanvasBlob(canvas, quality) {
        return new Promise((resolve) => {
            canvas.toBlob((blob) => {
                resolve(blob);
            }, 'image/jpeg', quality);
        });
    }

    /**
     * Inserta metadatos JFIF/EXIF para definir DPI
     * Usa la librería piexifjs
     */
    function insertDpiMetadata(jpegBase64, dpi) {
        // 1. Crear objeto de metadatos "0th" (Image File Directory 0)
        // XResolution y YResolution usan formato Racional [numerador, denominador]
        const zeroth = {};
        
        // Tags estándar para resolución
        zeroth[piexif.ImageIFD.XResolution] = [dpi, 1];
        zeroth[piexif.ImageIFD.YResolution] = [dpi, 1];
        zeroth[piexif.ImageIFD.ResolutionUnit] = 2; // 2 = Pulgadas (Inches)
        
        // Opcional: Software que generó la imagen
        zeroth[piexif.ImageIFD.Software] = "Herramienta Postulante UNSA";

        const exifObj = { "0th": zeroth, "Exif": {}, "GPS": {} };
        
        // 2. Convertir objeto a string binario exif
        const exifBytes = piexif.dump(exifObj);

        // 3. Insertar en el base64 original
        // piexif.insert devuelve el nuevo base64 completo
        const newJpegBase64 = piexif.insert(exifBytes, jpegBase64);
        
        return newJpegBase64;
    }

    function displayResults(finalBase64, sizeBytes) {
        editorStep.classList.add('hidden');
        resultStep.classList.remove('hidden');

        // Mostrar imagen final
        finalImagePreview.src = finalBase64;

        // Actualizar datos
        const sizeKB = (sizeBytes / 1024).toFixed(2);
        document.getElementById('final-size').textContent = `${sizeKB} KB`;
        document.getElementById('final-size').className = 
            (sizeBytes >= 4096 && sizeBytes <= (50 * 1024)) 
            ? "font-mono font-bold text-green-600" 
            : "font-mono font-bold text-red-600";

        // Configurar botón de descarga
        btnDownload.href = finalBase64;
        // Nombre de archivo con fecha para evitar caché
        const timestamp = new Date().getTime();
        btnDownload.download = `foto_postulante_unsa_${timestamp}.jpg`;
    }

    function showLoading(show, text = '') {
        if (show) {
            loadingText.textContent = text;
            loadingScreen.classList.remove('hidden');
        } else {
            loadingScreen.classList.add('hidden');
        }
    }
});