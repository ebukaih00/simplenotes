// Simple Notes - Figma Plugin Main Thread Code

// Show the plugin UI with a nice default size
figma.showUI(__html__, {
  width: 680,
  height: 520,
  title: "Simple Notes",
  themeColors: true // support figma dark mode theme styling colors if needed
});

// Event listener for messages from the UI iframe
figma.ui.onmessage = async (msg) => {
  switch (msg.type) {
    case 'init':
      // Send saved notes and settings to the UI when it initializes
      try {
        const notes = await figma.clientStorage.getAsync('simple_notes_data');
        const settings = await figma.clientStorage.getAsync('simple_notes_settings');
        figma.ui.postMessage({
          type: 'initData',
          notes: notes || [],
          settings: settings || {}
        });
      } catch (err) {
        console.error("Error loading notes from clientStorage:", err);
        figma.ui.postMessage({
          type: 'initData',
          notes: [],
          settings: {}
        });
      }
      break;

    case 'saveNotes':
      try {
        await figma.clientStorage.setAsync('simple_notes_data', msg.notes);
      } catch (err) {
        console.error("Error saving notes to clientStorage:", err);
      }
      break;

    case 'saveSettings':
      try {
        await figma.clientStorage.setAsync('simple_notes_settings', msg.settings);
      } catch (err) {
        console.error("Error saving settings to clientStorage:", err);
      }
      break;

    case 'resize':
      // Resize UI window
      figma.ui.resize(msg.width, msg.height);
      break;

    case 'insertIntoCanvas':
      try {
        const blocks = msg.blocks || [];
        const title = msg.title || 'Untitled';
        if (blocks.length === 0) {
          figma.notify("Note is empty. Add some content first!");
          break;
        }

        const createdNodes = [];

        // Check if we are in FigJam or Figma
        if (figma.editorType === 'figjam') {
          // FigJam mode
          // 1. Group all non-table blocks together to put in a single Sticky Note
          const stickySegments = [];
          const nonTableBlocks = blocks.filter(b => b.type !== 'table');
          
          for (let i = 0; i < nonTableBlocks.length; i++) {
            const block = nonTableBlocks[i];
            
            // Add a double newline between blocks
            if (stickySegments.length > 0) {
              stickySegments.push({ text: '\n\n' });
            }
            
            if (block.type === 'h1' || block.type === 'h2') {
              // headers are bold
              const headerSegments = (block.segments || []).map(s => Object.assign({}, s, { bold: true }));
              stickySegments.push.apply(stickySegments, headerSegments);
            } else if (block.type === 'paragraph') {
              stickySegments.push.apply(stickySegments, block.segments || []);
            } else if (block.type === 'blockquote') {
              // blockquotes are italic
              const quoteSegments = (block.segments || []).map(s => Object.assign({}, s, { italic: true }));
              stickySegments.push({ text: '“ ' });
              stickySegments.push.apply(stickySegments, quoteSegments);
              stickySegments.push({ text: ' ”' });
            } else if (block.type === 'hr') {
              stickySegments.push({ text: '────────────────────' });
            } else if (block.type === 'bullet_list') {
              const listItems = block.items || [];
              for (let j = 0; j < listItems.length; j++) {
                if (j > 0) stickySegments.push({ text: '\n' });
                stickySegments.push({ text: '•  ' });
                stickySegments.push.apply(stickySegments, listItems[j].segments || []);
              }
            } else if (block.type === 'numbered_list') {
              const listItems = block.items || [];
              for (let j = 0; j < listItems.length; j++) {
                if (j > 0) stickySegments.push({ text: '\n' });
                stickySegments.push({ text: `${j + 1}.  ` });
                stickySegments.push.apply(stickySegments, listItems[j].segments || []);
              }
            } else if (block.type === 'checklist') {
              const listItems = block.items || [];
              for (let j = 0; j < listItems.length; j++) {
                if (j > 0) stickySegments.push({ text: '\n' });
                const prefix = listItems[j].checked ? "☑  " : "☐  ";
                stickySegments.push({ text: prefix });
                stickySegments.push.apply(stickySegments, listItems[j].segments || []);
              }
            }
          }

          let lastNode = null;
          const startX = figma.viewport.center.x;
          const startY = figma.viewport.center.y;

          if (stickySegments.length > 0) {
            const stickyNode = figma.createSticky();
            const fontName = { family: "Inter", style: "Medium" };
            await figma.loadFontAsync(fontName);
            
            try {
              await formatTextNodeWithSegments(stickyNode.text, stickySegments);
            } catch (e) {
              console.warn("Failed to format FigJam sticky text node:", e);
              stickyNode.text.characters = stickySegments.map(s => s.text).join('');
            }
            
            stickyNode.x = startX - stickyNode.width / 2;
            stickyNode.y = startY - stickyNode.height / 2;
            
            figma.currentPage.appendChild(stickyNode);
            createdNodes.push(stickyNode);
            lastNode = stickyNode;
          }

          // 2. Create native TableNode for each table block
          const tableBlocks = blocks.filter(b => b.type === 'table');
          for (let i = 0; i < tableBlocks.length; i++) {
            const tableBlock = tableBlocks[i];
            const rows = tableBlock.rows || [];
            if (rows.length === 0) continue;

            const numRows = rows.length;
            const numCols = rows[0].length;

            const tableNode = figma.createTable(numRows, numCols);

            // Populate cells
            for (let r = 0; r < numRows; r++) {
              for (let c = 0; c < numCols; c++) {
                const cell = rows[r][c] || { isHeader: false, segments: [] };
                const tableCellNode = tableNode.cellAt(r, c);
                
                // Set text formatting
                let cellSegments = cell.segments || [];
                if (r === 0 || cell.isHeader) {
                  cellSegments = cellSegments.map(s => Object.assign({}, s, { bold: true }));
                }
                
                try {
                  await figma.loadFontAsync(tableCellNode.text.fontName);
                  await formatTextNodeWithSegments(tableCellNode.text, cellSegments);
                } catch (e) {
                  console.warn("Failed to format cell text:", e);
                  tableCellNode.text.characters = cellSegments.map(s => s.text).join('');
                }
              }
            }

            // Position table to the right of the sticky note or preceding tables
            if (lastNode) {
              tableNode.x = lastNode.x + lastNode.width + 40;
              tableNode.y = lastNode.y;
            } else {
              tableNode.x = startX - tableNode.width / 2;
              tableNode.y = startY - tableNode.height / 2;
            }

            figma.currentPage.appendChild(tableNode);
            createdNodes.push(tableNode);
            lastNode = tableNode;
          }

          if (createdNodes.length > 0) {
            figma.currentPage.selection = createdNodes;
            figma.viewport.scrollAndZoomIntoView(createdNodes);
            figma.notify("Created note elements in FigJam!");
          }
        } else {
          // Figma Design mode: Create a single unified Auto-Layout parent frame
          const parentFrame = figma.createFrame();
          parentFrame.name = "📝 Note: " + title;
          parentFrame.layoutMode = "VERTICAL";
          parentFrame.primaryAxisSizingMode = "AUTO";
          parentFrame.counterAxisSizingMode = "AUTO";
          parentFrame.paddingLeft = 24;
          parentFrame.paddingRight = 24;
          parentFrame.paddingTop = 24;
          parentFrame.paddingBottom = 24;
          parentFrame.itemSpacing = 16;
          parentFrame.cornerRadius = 8;
          
          // Light cream background: #FAF9F5
          parentFrame.fills = [{
            type: 'SOLID',
            color: { r: 250/255, g: 249/255, b: 245/255 }
          }];
          parentFrame.strokes = [{
            type: 'SOLID',
            color: { r: 226/255, g: 222/255, b: 217/255 }
          }];
          parentFrame.strokeWeight = 1;

          // Process each block
          for (const block of blocks) {
            if (block.type === 'h1') {
              const textNode = figma.createText();
              await figma.loadFontAsync({ family: "Inter", style: "Bold" });
              textNode.fontName = { family: "Inter", style: "Bold" };
              textNode.fontSize = 20;
              textNode.fills = [{ type: 'SOLID', color: { r: 28/255, g: 25/255, b: 23/255 } }];
              textNode.layoutAlign = "STRETCH";
              textNode.textAutoResize = "HEIGHT";
              
              await formatTextNodeWithSegments(textNode, block.segments || []);
              parentFrame.appendChild(textNode);
            } 
            else if (block.type === 'h2') {
              const textNode = figma.createText();
              await figma.loadFontAsync({ family: "Inter", style: "Bold" });
              textNode.fontName = { family: "Inter", style: "Bold" };
              textNode.fontSize = 16;
              textNode.fills = [{ type: 'SOLID', color: { r: 28/255, g: 25/255, b: 23/255 } }];
              textNode.layoutAlign = "STRETCH";
              textNode.textAutoResize = "HEIGHT";
              
              await formatTextNodeWithSegments(textNode, block.segments || []);
              parentFrame.appendChild(textNode);
            }
            else if (block.type === 'paragraph') {
              const textNode = figma.createText();
              const fontName = { family: "Inter", style: "Regular" };
              await figma.loadFontAsync(fontName);
              textNode.fontName = fontName;
              textNode.fontSize = 14;
              textNode.layoutAlign = "STRETCH";
              textNode.textAutoResize = "HEIGHT";
              textNode.fills = [{ type: 'SOLID', color: { r: 36/255, g: 34/255, b: 32/255 } }];
              
              await formatTextNodeWithSegments(textNode, block.segments || []);
              parentFrame.appendChild(textNode);
            }
            else if (block.type === 'blockquote') {
              const quoteFrame = figma.createFrame();
              quoteFrame.name = "Blockquote";
              quoteFrame.layoutMode = "HORIZONTAL";
              quoteFrame.primaryAxisSizingMode = "AUTO";
              quoteFrame.counterAxisSizingMode = "AUTO";
              quoteFrame.itemSpacing = 12;
              quoteFrame.layoutAlign = "STRETCH";
              quoteFrame.fills = [];
              quoteFrame.strokes = [];
              
              const borderLine = figma.createFrame();
              borderLine.name = "Border";
              borderLine.resize(4, 20);
              borderLine.layoutAlign = "STRETCH";
              borderLine.fills = [{ type: 'SOLID', color: { r: 214/255, g: 211/255, b: 209/255 } }];
              borderLine.cornerRadius = 2;
              quoteFrame.appendChild(borderLine);
              
              const textNode = figma.createText();
              const fontName = { family: "Inter", style: "Italic" };
              await figma.loadFontAsync(fontName);
              textNode.fontName = fontName;
              textNode.fontSize = 14;
              textNode.layoutAlign = "STRETCH";
              textNode.textAutoResize = "HEIGHT";
              textNode.fills = [{ type: 'SOLID', color: { r: 120/255, g: 113/255, b: 108/255 } }];
              
              await formatTextNodeWithSegments(textNode, block.segments || []);
              quoteFrame.appendChild(textNode);
              parentFrame.appendChild(quoteFrame);
            }
            else if (block.type === 'hr') {
              const hrFrame = figma.createFrame();
              hrFrame.name = "Divider";
              hrFrame.resize(100, 1);
              hrFrame.layoutAlign = "STRETCH";
              hrFrame.fills = [{ type: 'SOLID', color: { r: 231/255, g: 229/255, b: 228/255 } }];
              parentFrame.appendChild(hrFrame);
            }
            else if (block.type === 'bullet_list') {
              const listItems = block.items || [];
              for (const item of listItems) {
                const textNode = figma.createText();
                const fontName = { family: "Inter", style: "Regular" };
                await figma.loadFontAsync(fontName);
                textNode.fontName = fontName;
                textNode.fontSize = 14;
                textNode.layoutAlign = "STRETCH";
                textNode.textAutoResize = "HEIGHT";
                textNode.fills = [{ type: 'SOLID', color: { r: 36/255, g: 34/255, b: 32/255 } }];
                
                const itemSegments = [{ text: "•  " }].concat(item.segments || []);
                await formatTextNodeWithSegments(textNode, itemSegments);
                parentFrame.appendChild(textNode);
              }
            }
            else if (block.type === 'numbered_list') {
              const listItems = block.items || [];
              for (let j = 0; j < listItems.length; j++) {
                const item = listItems[j];
                const textNode = figma.createText();
                const fontName = { family: "Inter", style: "Regular" };
                await figma.loadFontAsync(fontName);
                textNode.fontName = fontName;
                textNode.fontSize = 14;
                textNode.layoutAlign = "STRETCH";
                textNode.textAutoResize = "HEIGHT";
                textNode.fills = [{ type: 'SOLID', color: { r: 36/255, g: 34/255, b: 32/255 } }];
                
                const itemSegments = [{ text: `${j + 1}.  ` }].concat(item.segments || []);
                await formatTextNodeWithSegments(textNode, itemSegments);
                parentFrame.appendChild(textNode);
              }
            }
            else if (block.type === 'checklist') {
              const listItems = block.items || [];
              for (const item of listItems) {
                const textNode = figma.createText();
                const fontName = { family: "Inter", style: "Regular" };
                await figma.loadFontAsync(fontName);
                textNode.fontName = fontName;
                textNode.fontSize = 14;
                textNode.layoutAlign = "STRETCH";
                textNode.textAutoResize = "HEIGHT";
                
                const prefix = item.checked ? "☑  " : "☐  ";
                const itemSegments = [{ text: prefix }].concat(item.segments || []);
                await formatTextNodeWithSegments(textNode, itemSegments);
                
                if (item.checked) {
                  textNode.fills = [{ type: 'SOLID', color: { r: 120/255, g: 113/255, b: 108/255 } }];
                } else {
                  textNode.fills = [{ type: 'SOLID', color: { r: 36/255, g: 34/255, b: 32/255 } }];
                }
                parentFrame.appendChild(textNode);
              }
            }
            else if (block.type === 'table') {
              const rows = block.rows || [];
              if (rows.length === 0) continue;

              const numRows = rows.length;
              const numCols = rows[0].length;

              const tableContainer = figma.createFrame();
              tableContainer.name = "Table";
              tableContainer.layoutMode = "VERTICAL";
              tableContainer.primaryAxisSizingMode = "AUTO";
              tableContainer.counterAxisSizingMode = "AUTO";
              tableContainer.itemSpacing = -1; // Merge horizontal borders
              tableContainer.cornerRadius = 6;
              tableContainer.clipsContent = true;
              tableContainer.layoutAlign = "STRETCH";
              tableContainer.strokes = [{
                type: 'SOLID',
                color: { r: 226/255, g: 222/255, b: 217/255 }
              }];
              tableContainer.strokeWeight = 1;
              tableContainer.fills = [];

              for (let r = 0; r < numRows; r++) {
                const rowFrame = figma.createFrame();
                rowFrame.name = r === 0 ? "Header Row" : `Row ${r}`;
                rowFrame.layoutMode = "HORIZONTAL";
                rowFrame.primaryAxisSizingMode = "AUTO";
                rowFrame.counterAxisSizingMode = "AUTO";
                rowFrame.itemSpacing = -1; // Merge vertical borders
                rowFrame.layoutAlign = "STRETCH";
                rowFrame.fills = [];

                for (let c = 0; c < numCols; c++) {
                  const cell = rows[r][c] || { isHeader: false, segments: [] };
                  const cellFrame = figma.createFrame();
                  cellFrame.name = `Cell ${r}-${c}`;
                  cellFrame.layoutMode = "VERTICAL";
                  
                  // Use Auto Layout vertical wrapping and fixed width for column grid feel
                  cellFrame.primaryAxisSizingMode = "AUTO";
                  cellFrame.counterAxisSizingMode = "FIXED";
                  cellFrame.resize(150, 36);
                  cellFrame.paddingLeft = 10;
                  cellFrame.paddingRight = 10;
                  cellFrame.paddingTop = 8;
                  cellFrame.paddingBottom = 8;
                  cellFrame.layoutAlign = "STRETCH"; // Stretch vertically to tallest cell in row

                  // Fills: Header is dark stone #1C1917, cells alternate light colors
                  const isHeader = r === 0 || cell.isHeader;
                  if (isHeader) {
                    cellFrame.fills = [{
                      type: 'SOLID',
                      color: { r: 28/255, g: 25/255, b: 23/255 }
                    }];
                  } else {
                    const isEven = r % 2 === 0;
                    cellFrame.fills = [{
                      type: 'SOLID',
                      color: isEven ? { r: 250/255, g: 249/255, b: 245/255 } : { r: 1, g: 1, b: 1 }
                    }];
                  }

                  // Inner cell grid lines
                  cellFrame.strokes = [{
                    type: 'SOLID',
                    color: isHeader ? { r: 45/255, g: 42/255, b: 39/255 } : { r: 226/255, g: 222/255, b: 217/255 }
                  }];
                  cellFrame.strokeWeight = 1;

                  // Add Text Node in Cell
                  const cellText = figma.createText();
                  const fontStyle = isHeader ? "Bold" : "Regular";
                  await figma.loadFontAsync({ family: "Inter", style: fontStyle });
                  cellText.fontName = { family: "Inter", style: fontStyle };
                  cellText.fontSize = 12;
                  
                  let cellSegments = cell.segments || [];
                  if (isHeader) {
                    cellSegments = cellSegments.map(s => Object.assign({}, s, { bold: true }));
                  }
                  
                  cellText.fills = [{
                    type: 'SOLID',
                    color: isHeader ? { r: 250/255, g: 249/255, b: 245/255 } : { r: 36/255, g: 34/255, b: 32/255 }
                  }];
                  cellText.layoutAlign = "STRETCH";
                  cellText.textAutoResize = "HEIGHT"; // Auto wrap cell text height-wise

                  await formatTextNodeWithSegments(cellText, cellSegments);
                  cellFrame.appendChild(cellText);
                  rowFrame.appendChild(cellFrame);
                }

                tableContainer.appendChild(rowFrame);
              }

              parentFrame.appendChild(tableContainer);
            }
          }

          // Position parent frame in center of viewport
          parentFrame.x = figma.viewport.center.x - parentFrame.width / 2;
          parentFrame.y = figma.viewport.center.y - parentFrame.height / 2;

          figma.currentPage.appendChild(parentFrame);
          createdNodes.push(parentFrame);

          figma.currentPage.selection = [parentFrame];
          figma.viewport.scrollAndZoomIntoView([parentFrame]);
          figma.notify("Inserted note as Auto-Layout frame with visual tables in Figma!");
        }
      } catch (err) {
        console.error("Error inserting note into canvas:", err);
        figma.notify("Failed to insert note: " + err.message);
      }
      break;

    case 'getFrames':
      try {
        const fileKey = figma.fileKey;
        const frames = figma.currentPage.findAll(node => node.type === "FRAME" || node.type === "SECTION").map(f => {
          let url = `figma://node-id=${encodeURIComponent(f.id)}`;
          if (fileKey) {
            url = `https://www.figma.com/file/${fileKey}/?node-id=${encodeURIComponent(f.id)}`;
          }
          return {
            id: f.id,
            name: f.name,
            url: url
          };
        });
        figma.ui.postMessage({
          type: 'framesList',
          frames: frames
        });
      } catch (err) {
        console.error("Error fetching frames:", err);
        figma.ui.postMessage({
          type: 'framesList',
          frames: []
        });
      }
      break;

    case 'goToFrame':
      try {
        const node = figma.getNodeById(msg.nodeId);
        if (node) {
          figma.currentPage.selection = [node];
          figma.viewport.scrollAndZoomIntoView([node]);
          figma.notify(`Zoomed to frame: ${node.name}`);
        } else {
          figma.notify("Frame not found or deleted", { error: true });
        }
      } catch (err) {
        console.error("Error navigation to frame:", err);
        figma.notify("Error navigation to frame", { error: true });
      }
      break;

    case 'notify':
      // Let UI show figma system notifications
      figma.notify(msg.message, { error: msg.error || false });
      break;

    case 'attachToFrame':
      (async () => {
        try {
          const frameNode = figma.getNodeById(msg.frameId);
          if (frameNode) {
            // Delete old one if exists
            if (msg.oldBadgeNodeId) {
              const oldBadge = figma.getNodeById(msg.oldBadgeNodeId);
              if (oldBadge) {
                try { oldBadge.remove(); } catch(e) {}
              }
            }

            // Create new badge
            const badge = figma.createFrame();
            badge.name = `✏️ Simple Note: ${msg.noteTitle}`;
            badge.cornerRadius = 6;
            
            // Dark stone background color: #1C1917
            badge.fills = [{
              type: 'SOLID',
              color: { r: 28/255, g: 25/255, b: 23/255 }
            }];
            
            // Auto layout layout constraints
            badge.layoutMode = "HORIZONTAL";
            badge.primaryAxisSizingMode = "AUTO";
            badge.counterAxisSizingMode = "AUTO";
            badge.paddingLeft = 8;
            badge.paddingRight = 8;
            badge.paddingTop = 6;
            badge.paddingBottom = 6;
            badge.itemSpacing = 6;
            badge.counterAxisAlignItems = "CENTER";
            
            // Create text node
            const textNode = figma.createText();
            await figma.loadFontAsync({ family: "Inter", style: "Medium" });
            textNode.fontName = { family: "Inter", style: "Medium" };
            textNode.characters = `📝 ${msg.noteTitle}`;
            textNode.fontSize = 11;
            textNode.fills = [{
              type: 'SOLID',
              color: { r: 250/255, g: 249/255, b: 245/255 }
            }];
            
            badge.appendChild(textNode);
            
            // Position badge at the top-right corner of the frame
            badge.x = frameNode.x + frameNode.width - 120;
            badge.y = frameNode.y - 40;
            
            // Store note ID inside the badge
            badge.setPluginData("associatedNoteId", msg.noteId);
            
            // Add to page
            figma.currentPage.appendChild(badge);
            
            // Post back to UI to save badgeNodeId and frame info
            figma.ui.postMessage({
              type: 'badgeCreated',
              noteId: msg.noteId,
              badgeNodeId: badge.id,
              frameId: msg.frameId,
              frameName: frameNode.name
            });
            
            figma.notify(`Attached note to frame: ${frameNode.name}`);
          } else {
            figma.notify("Frame not found", { error: true });
          }
        } catch (err) {
          console.error("Error attaching note to frame:", err);
          figma.notify("Failed to attach note: " + err.message, { error: true });
        }
      })();
      break;

    case 'detachFromFrame':
      try {
        if (msg.badgeNodeId) {
          const badge = figma.getNodeById(msg.badgeNodeId);
          if (badge) {
            badge.remove();
          }
        }
        figma.notify("Detached note from frame");
      } catch (err) {
        console.error("Error detaching from frame:", err);
      }
      break;

    case 'updateBadgeTitle':
      (async () => {
        try {
          if (msg.badgeNodeId) {
            const badge = figma.getNodeById(msg.badgeNodeId);
            if (badge && badge.type === "FRAME") {
              badge.name = `✏️ Simple Note: ${msg.noteTitle}`;
              const textNode = badge.children.find(c => c.type === "TEXT");
              if (textNode) {
                await figma.loadFontAsync(textNode.fontName);
                textNode.characters = `📝 ${msg.noteTitle}`;
              }
            }
          }
        } catch (err) {
          console.error("Error updating badge title:", err);
        }
      })();
      break;

    default:
      console.warn("Unknown message type:", msg.type);
  }
};

// Listen for selection changes in the canvas
figma.on("selectionchange", () => {
  try {
    if (!figma.ui) return;
    const selection = figma.currentPage.selection;
    if (selection && selection.length === 1) {
      const node = selection[0];
      if (node && !node.removed && typeof node.getPluginData === 'function') {
        const associatedNoteId = node.getPluginData("associatedNoteId");
        if (associatedNoteId) {
          figma.ui.postMessage({
            type: 'selectNoteById',
            noteId: associatedNoteId
          });
        }
      }
    }
  } catch (err) {
    console.error("Error in selectionchange listener:", err.message, err.stack);
  }
});



async function formatTextNodeWithSegments(textNode, segments) {
  const plainText = segments.map(s => s.text).join('');
  const defaultFont = { family: "Inter", style: "Regular" };
  await figma.loadFontAsync(defaultFont);
  textNode.fontName = defaultFont;
  textNode.characters = plainText || ' ';
  
  if (!plainText) return;
  
  const boldFont = { family: "Inter", style: "Bold" };
  const italicFont = { family: "Inter", style: "Italic" };
  const boldItalicFont = { family: "Inter", style: "Bold Italic" };
  const codeFont = { family: "Courier", style: "Regular" };
  
  let hasBold = segments.some(s => s.bold);
  let hasItalic = segments.some(s => s.italic);
  let hasCode = segments.some(s => s.code);
  
  if (hasBold && hasItalic) {
    try { await figma.loadFontAsync(boldItalicFont); } catch(e) {}
  }
  if (hasBold) {
    try { await figma.loadFontAsync(boldFont); } catch(e) {}
  }
  if (hasItalic) {
    try { await figma.loadFontAsync(italicFont); } catch(e) {}
  }
  if (hasCode) {
    try { await figma.loadFontAsync(codeFont); } catch(e) {}
  }
  
  let currentIndex = 0;
  for (const s of segments) {
    const len = s.text.length;
    if (len === 0) continue;
    
    const start = currentIndex;
    const end = currentIndex + len;
    
    try {
      if (s.code) {
        textNode.setRangeFontName(start, end, codeFont);
      } else if (s.bold && s.italic) {
        textNode.setRangeFontName(start, end, boldItalicFont);
      } else if (s.bold) {
        textNode.setRangeFontName(start, end, boldFont);
      } else if (s.italic) {
        textNode.setRangeFontName(start, end, italicFont);
      } else {
        textNode.setRangeFontName(start, end, defaultFont);
      }
      
      if (s.underline) {
        textNode.setRangeTextDecoration(start, end, "UNDERLINE");
      } else {
        textNode.setRangeTextDecoration(start, end, "NONE");
      }
      
      if (s.linkUrl) {
        textNode.setRangeHyperlink(start, end, { type: "URL", value: s.linkUrl });
      }
    } catch (e) {
      console.warn("Failed to apply range style:", e);
    }
    
    currentIndex = end;
  }
}


